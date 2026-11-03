import { describe, expect, it } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import {
  IMPORT_BANK_STATEMENT_MESSAGES,
  ImportBankStatement,
  MAX_STATEMENT_ROWS,
  type BankStatementAccountReader,
  type BankStatementReconciler,
} from '../../../src/modules/integrations/application/use-cases/bank/import-bank-statement.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { NotFoundError } from '../../../src/shared/domain';
import { FAKE_STATEMENT_CONTENT_TYPE, InMemoryBank } from '../../support/fakes/in-memory-bank';
import { InMemoryAccountLedgerForBankMatch } from '../../support/fakes/in-memory-account-ledger-for-bank-match';

const userOf = (role: CurrentUser['role']): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `clerk_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});
const owner = userOf('OWNER');
const member = userOf('MEMBER');
const viewer = userOf('VIEWER');

const bytes = (text: string) => new TextEncoder().encode(text);
const CT = FAKE_STATEMENT_CONTENT_TYPE;

class CountingBank extends InMemoryBank {
  calls = 0;
  override async parseStatement(...args: Parameters<InMemoryBank['parseStatement']>) {
    this.calls += 1;
    return super.parseStatement(...args);
  }
}

function build(
  account: { type: string; active: boolean } | null = { type: 'BANCO_NACIONAL', active: true },
) {
  const bank = new CountingBank();
  const ledger = new InMemoryAccountLedgerForBankMatch();
  const reconciled: unknown[] = [];
  const accounts: BankStatementAccountReader = {
    execute: async () => {
      if (!account) throw new NotFoundError();
      return account;
    },
  };
  const reconciler: BankStatementReconciler = {
    execute: async (_actor, accountId, input) => {
      reconciled.push({ accountId, ...input });
      return { id: 'rec_1', difference: '0.00' };
    },
  };
  return {
    bank,
    ledger,
    reconciled,
    useCase: new ImportBankStatement(new MatrixAuthorization(), accounts, bank, ledger, reconciler),
  };
}

describe('ImportBankStatement', () => {
  it('matches lines to ledger records and reports the unmatched on both sides', async () => {
    const w = build();
    w.ledger.seed('acc_1', [
      { id: 'pay_1', kind: 'PAYMENT', date: '2026-10-05', amount: '100.00', reference: null },
      { id: 'exp_1', kind: 'EXPENSE', date: '2026-10-06', amount: '-20.00', reference: null },
      { id: 'mov_9', kind: 'MOVEMENT', date: '2026-10-07', amount: '5.00', reference: null },
    ]);
    const out = await w.useCase.execute(owner, {
      accountId: 'acc_1',
      bytes: bytes('2026-10-05;100.00;;deposit\n2026-10-06;-20.00;;fee\n2026-10-08;77.00;;mystery'),
      contentType: CT,
      statementBalance: '300.00',
    });
    expect(out.matched).toEqual([
      { rowNumber: 1, recordId: 'pay_1' },
      { rowNumber: 2, recordId: 'exp_1' },
    ]);
    expect(out.unmatchedLines).toEqual([3]);
    expect(out.unmatchedRecords).toEqual(['mov_9']);
    expect(out.statementBalance).toBe('300.00');
    expect(out.reconciliation).toBeNull();
    expect(w.reconciled).toEqual([]);
  });

  it('looks the ledger up over the statement window widened by the match window', async () => {
    const w = build();
    w.ledger.seed('acc_1', [
      { id: 'near', kind: 'PAYMENT', date: '2026-10-02', amount: '10.00', reference: null },
      { id: 'far', kind: 'PAYMENT', date: '2026-09-20', amount: '10.00', reference: null },
    ]);
    const out = await w.useCase.execute(owner, {
      accountId: 'acc_1',
      bytes: bytes('2026-10-05;10.00;;x'),
      contentType: CT,
    });
    expect(out.matched).toEqual([{ rowNumber: 1, recordId: 'near' }]);
    expect(out.unmatchedRecords).toEqual([]);
    expect(out.statementBalance).toBeNull();
  });

  it('reads the ledger as the actor of the import', async () => {
    const w = build();
    await w.useCase.execute(owner, {
      accountId: 'acc_1',
      bytes: bytes('2026-10-05;10.00;;x'),
      contentType: CT,
    });
    expect(w.ledger.actors).toEqual([owner]);
  });

  it('refuses a Member and a Viewer before parsing anything', async () => {
    for (const actor of [member, viewer]) {
      const w = build();
      await expect(
        w.useCase.execute(actor, { accountId: 'acc_1', bytes: bytes('x'), contentType: CT }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(w.bank.calls).toBe(0);
    }
  });

  it('answers NOT_FOUND for an unknown account and VALIDATION for an inactive or non-bank one', async () => {
    const input = { accountId: 'acc_1', bytes: bytes('2026-10-05;1.00;;x'), contentType: CT };
    const missing = build(null);
    await expect(missing.useCase.execute(owner, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(missing.bank.calls).toBe(0);

    const inactive = build({ type: 'BANCO_NACIONAL', active: false });
    await expect(inactive.useCase.execute(owner, input)).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountId: [IMPORT_BANK_STATEMENT_MESSAGES.accountInactive] },
    });
    for (const type of ['EFECTIVO', 'WALLET_CRIPTO', 'BILLETERA_DIGITAL']) {
      const w = build({ type, active: true });
      await expect(w.useCase.execute(owner, input)).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { accountId: [IMPORT_BANK_STATEMENT_MESSAGES.accountNotBank] },
      });
      expect(w.bank.calls).toBe(0);
    }
    const intl = build({ type: 'BANCO_INTERNACIONAL', active: true });
    await expect(intl.useCase.execute(owner, input)).resolves.toBeDefined();
  });

  it('fails the whole file with the row number of a malformed row and stores nothing', async () => {
    const w = build();
    await expect(
      w.useCase.execute(owner, {
        accountId: 'acc_1',
        bytes: bytes('2026-10-05;10.00;;ok\n2026-10-06;abc;;bad'),
        contentType: CT,
        reconcile: true,
        statementBalance: '10.00',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { row: ['2'] } });
    expect(w.reconciled).toEqual([]);
  });

  it('caps the rows in the use case', async () => {
    const w = build();
    const rows = Array.from({ length: MAX_STATEMENT_ROWS + 1 }, () => '2026-10-05;1.00;;x');
    await expect(
      w.useCase.execute(owner, {
        accountId: 'acc_1',
        bytes: bytes(rows.join('\n')),
        contentType: CT,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { file: [IMPORT_BANK_STATEMENT_MESSAGES.tooManyRows] },
    });
    const ok = rows.slice(0, MAX_STATEMENT_ROWS);
    await expect(
      w.useCase.execute(owner, {
        accountId: 'acc_1',
        bytes: bytes(ok.join('\n')),
        contentType: CT,
      }),
    ).resolves.toBeDefined();
  });

  it('answers an empty statement as VALIDATION', async () => {
    const w = build();
    await expect(
      w.useCase.execute(owner, { accountId: 'acc_1', bytes: bytes('\n'), contentType: CT }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { file: [IMPORT_BANK_STATEMENT_MESSAGES.emptyStatement] },
    });
  });

  it('reconciles through ReconcileAccount only when asked, at the last line date', async () => {
    const w = build();
    const out = await w.useCase.execute(owner, {
      accountId: 'acc_1',
      bytes: bytes('2026-10-05;10.00;;a\n2026-10-09;5.00;;b\n2026-10-07;1.00;;c'),
      contentType: CT,
      statementBalance: '250.50',
      reconcile: true,
    });
    expect(w.reconciled).toEqual([
      { accountId: 'acc_1', date: '2026-10-09', statementBalance: '250.50' },
    ]);
    expect(out.reconciliation).toEqual({ id: 'rec_1', difference: '0.00' });
  });

  it('rejects reconcile without a statement balance before parsing', async () => {
    const w = build();
    await expect(
      w.useCase.execute(owner, {
        accountId: 'acc_1',
        bytes: bytes('2026-10-05;10.00;;a'),
        contentType: CT,
        reconcile: true,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { statementBalance: [IMPORT_BANK_STATEMENT_MESSAGES.balanceRequired] },
    });
    expect(w.bank.calls).toBe(0);
    expect(w.reconciled).toEqual([]);
  });
});
