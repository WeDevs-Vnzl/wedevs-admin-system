import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAccountRepository } from '../../../src/modules/finance/infrastructure/prisma-account.repository';
import { CreateMovement } from '../../../src/modules/finance/application/use-cases/accounts/create-movement.use-case';
import { GetAccount } from '../../../src/modules/finance/application/use-cases/accounts/get-account.use-case';
import { GetAccountLedger } from '../../../src/modules/finance/application/use-cases/accounts/get-account-ledger.use-case';
import { ReconcileAccount } from '../../../src/modules/finance/application/use-cases/accounts/reconcile-account.use-case';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { ImportBankStatement } from '../../../src/modules/integrations/application/use-cases/bank/import-bank-statement.use-case';
import { FinanceAccountLedgerForMatch } from '../../../src/modules/integrations/infrastructure/finance-account-ledger-for-match.adapter';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { buildWorld } from '../../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { InMemoryBank, FAKE_STATEMENT_CONTENT_TYPE } from '../../support/fakes/in-memory-bank';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const world = buildWorld(service);
const accounts = new PrismaAccountRepository(world.host);
const authorization = new MatrixAuthorization();
const clock = new SystemClock();
const ids = new CuidGenerator();
const activity = new PrismaActivityLog(world.host, world.metrics);
const locks = new PrismaRowLocks(world.host);

let actor: CurrentUser;
const getLedger = new GetAccountLedger(authorization, accounts);
const getAccount = new GetAccount(authorization, accounts, { getRateFor: async () => null }, clock);
const reconcile = new ReconcileAccount(
  authorization,
  world.uow,
  locks,
  accounts,
  world.sources,
  activity,
  clock,
  ids,
);
const createMovement = new CreateMovement(
  authorization,
  world.uow,
  locks,
  accounts,
  { find: async (id: string) => ({ id, name: id }), list: async () => [] },
  world.projector,
  activity,
  clock,
  ids,
);
const adapter = new FinanceAccountLedgerForMatch(getLedger, () => actor);
const importer = new ImportBankStatement(
  authorization,
  getAccount,
  new InMemoryBank(),
  adapter,
  reconcile,
);
const bytes = (text: string) => new TextEncoder().encode(text);

beforeAll(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: {
      clerkId: 'user_bank_int',
      email: 'bank-int@example.test',
      name: 'Owner',
      role: 'OWNER',
    },
  });
  actor = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: row.name };
  for (const [id, type, active] of [
    ['acc_bank', 'BANCO_NACIONAL', true],
    ['acc_cash', 'EFECTIVO', true],
    ['acc_off', 'BANCO_NACIONAL', false],
  ] as const) {
    await admin.account.create({
      data: {
        id,
        name: id,
        type,
        active,
        currency: 'USD',
        openingBalance: '1000.00',
        balance: '1000.00',
        openingDate: new Date('2026-01-01'),
      },
    });
  }
  for (const [date, amount, description] of [
    ['2026-10-05', '100.00', 'incoming'],
    ['2026-10-06', '-20.00', 'outgoing'],
    ['2026-10-20', '9.00', 'outside the statement window'],
  ] as const) {
    await createMovement.execute(actor, {
      accountId: 'acc_bank',
      type: 'AJUSTE',
      date,
      amount,
      usdRate: '1',
      description,
    });
  }
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const STATEMENT = '2026-10-05;100.00;;deposit\n2026-10-06;-20.00;;fee\n2026-10-07;3.33;;unknown';

describe('FinanceAccountLedgerForMatch (real database)', () => {
  it('maps the ledger rows of the window and skips the opening balance', async () => {
    const records = await adapter.entries('acc_bank', '2026-10-01', '2026-10-10');
    expect(records.map((r) => [r.kind, r.date, r.amount, r.reference])).toEqual([
      ['MOVEMENT', '2026-10-05', '100.00', null],
      ['MOVEMENT', '2026-10-06', '-20.00', null],
    ]);
  });
});

describe('ImportBankStatement (real database)', () => {
  it('matches against the real ledger and writes nothing when reconcile is off', async () => {
    const out = await importer.execute(actor, {
      accountId: 'acc_bank',
      bytes: bytes(STATEMENT),
      contentType: FAKE_STATEMENT_CONTENT_TYPE,
      statementBalance: '1080.00',
    });
    expect(out.matched.map((m) => m.rowNumber)).toEqual([1, 2]);
    expect(out.unmatchedLines).toEqual([3]);
    expect(out.unmatchedRecords).toEqual([]);
    expect(out.reconciliation).toBeNull();
    expect(await admin.accountReconciliation.count()).toBe(0);
  });

  it('stores one reconciliation through ReconcileAccount when reconcile is true', async () => {
    const out = await importer.execute(actor, {
      accountId: 'acc_bank',
      bytes: bytes(STATEMENT),
      contentType: FAKE_STATEMENT_CONTENT_TYPE,
      statementBalance: '1080.00',
      reconcile: true,
    });
    expect(out.reconciliation).toMatchObject({
      accountId: 'acc_bank',
      date: '2026-10-07',
      statementBalance: '1080.00',
      systemBalance: '1080.00',
      difference: '0.00',
    });
    const rows = await admin.accountReconciliation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accountId).toBe('acc_bank');
  });

  it('refuses an inactive account, a cash account and an unknown id', async () => {
    const input = { bytes: bytes(STATEMENT), contentType: FAKE_STATEMENT_CONTENT_TYPE };
    await expect(importer.execute(actor, { ...input, accountId: 'acc_off' })).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
    await expect(
      importer.execute(actor, { ...input, accountId: 'acc_cash' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(importer.execute(actor, { ...input, accountId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
