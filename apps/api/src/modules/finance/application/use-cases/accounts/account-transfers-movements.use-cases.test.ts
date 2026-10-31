import { describe, expect, it } from 'vitest';
import {
  createWorld,
  NOW,
  query,
  rejection,
  seedMockAccounts,
  type World,
} from '../../../../../../test/finance/accounts/world';

// Seed of the mock fixtures (today is 2026-10-09): Zelle USD 1000 + 500 - 200 - 100 = 1200; Binance USDT
// receives 99 from the transfer of 100; the VES account 5000 - 1500 (adjustment) = 3500.

const transfer = (from: string, to: string, over: Record<string, unknown> = {}) => ({
  date: '2026-10-01',
  fromAccountId: from,
  toAccountId: to,
  amountFrom: '100',
  amountTo: '99',
  feeAmount: '0',
  usdRate: '1',
  ...over,
});

const movement = (accountId: string, over: Record<string, unknown> = {}) => ({
  accountId,
  type: 'RETIRO_SOCIO' as const,
  date: '2026-10-02',
  amount: '50',
  usdRate: '1',
  partnerId: 'usr_andres',
  description: 'Retiro de prueba',
  ...over,
});

async function world() {
  const w = createWorld();
  const ids = await seedMockAccounts(w);
  return { w, ...ids };
}

const balance = (w: World, id: string) => w.getAccount.execute(w.owner, id).then((a) => a.balance);

describe('account balances (HU-15 CA1, §9.7)', () => {
  it('computes each balance from its opening, contributions, withdrawals, transfers and adjustments', async () => {
    const { w, zelle, binance, ves } = await world();
    expect(await balance(w, zelle)).toBe('1200.00');
    expect(await balance(w, binance)).toBe('99.00');
    expect(await balance(w, ves)).toBe('3500.00');
    expect(w.balanceOf(zelle)).toBe(w.computedBalance(zelle));
  });

  it('values the USDT balance in USD at 1 USDT = 1.01 USD', async () => {
    const { w, binance } = await world();
    expect((await w.getAccount.execute(w.owner, binance)).balanceUsd).toBe('99.99');
  });

  it('debits the transfer fee on top of the amount sent', async () => {
    const { w, zelle, binance } = await world();
    await w.createTransfer.execute(
      w.owner,
      transfer(zelle, binance, { amountTo: '98', feeAmount: '2' }),
    );
    expect(await balance(w, zelle)).toBe('1098.00');
  });

  it('applies the sign of a withdrawal and of a signed adjustment', async () => {
    const { w, zelle } = await world();
    await w.createMovement.execute(w.owner, movement(zelle));
    await w.createMovement.execute(
      w.owner,
      movement(zelle, { type: 'AJUSTE', amount: '-10', partnerId: undefined }),
    );
    expect(await balance(w, zelle)).toBe('1140.00');
  });

  it('lists the ledger in date order and ends on the account balance (incl. a RETIRO_SOCIO)', async () => {
    const { w, zelle } = await world();
    const ledger = await w.getLedger.execute(w.owner, zelle, query({ pageSize: 100 }));
    expect(ledger.items.map((row) => [row.kind, row.amount, row.balance])).toEqual([
      ['OPENING_BALANCE', '1000.00', '1000.00'],
      ['APORTE_CAPITAL', '500.00', '1500.00'],
      ['RETIRO_SOCIO', '-200.00', '1300.00'],
      ['TRANSFER_OUT', '-100.00', '1200.00'],
    ]);
    expect(ledger.items.at(-1)?.balance).toBe(w.balanceOf(zelle));
  });

  it('recording the suggested AJUSTE closes the reconciliation difference', async () => {
    const { w, zelle } = await world();
    const result = await w.reconcile.execute(w.owner, zelle, {
      date: '2026-10-09',
      statementBalance: '1300.00',
    });
    expect(result).toMatchObject({ systemBalance: '1200.00', suggestedAdjustment: '100.00' });
    await w.createMovement.execute(
      w.owner,
      movement(zelle, {
        type: 'AJUSTE',
        date: '2026-10-09',
        amount: result.suggestedAdjustment,
        partnerId: undefined,
        description: 'Ajuste por conciliación',
      }),
    );
    expect(await balance(w, zelle)).toBe('1300.00');
  });
});

describe('CreateTransfer (ported from createTransfer, HU-16)', () => {
  it('moves 100 from Zelle to Binance receiving 99 USDT: the origin loses 100 and the destination gains 99', async () => {
    const { w, zelle, binance } = await world();
    const created = await w.createTransfer.execute(w.owner, transfer(zelle, binance));
    expect(created).toMatchObject({
      fromAccount: { id: zelle, type: 'ACCOUNT' },
      toAccount: { id: binance, type: 'ACCOUNT' },
      amountFrom: '100.00',
      amountTo: '99.00',
      feeAmount: '0.00',
      amountUsd: '100.00',
      createdAt: NOW,
    });
    expect(await balance(w, zelle)).toBe('1100.00');
    expect(await balance(w, binance)).toBe('198.00');
  });

  it('snapshots the USD amount with the origin rate at write time, and keeps a cross rate', async () => {
    const { w, ves, binance } = await world();
    const created = await w.createTransfer.execute(
      w.owner,
      transfer(ves, binance, {
        amountFrom: '755.16',
        amountTo: '0.99',
        usdRate: '755.16',
        rate: '762.78',
        reference: 'REF-1',
      }),
    );
    expect(created).toMatchObject({ amountUsd: '1.00', rate: '762.78', reference: 'REF-1' });
  });

  it('projects the transfer facts and both balances in the same unit of work, and logs it', async () => {
    const { w, zelle, binance } = await world();
    w.facts.length = 0;
    const created = await w.createTransfer.execute(w.owner, transfer(zelle, binance));
    expect(w.facts).toContainEqual({
      sourceType: 'TRANSFER',
      sourceId: created.id,
      kinds: ['TRANSFER_OUT', 'TRANSFER_IN'],
    });
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'CREATE',
      entityType: 'TRANSFER',
      entityId: created.id,
      entityLabel: 'Zelle USD → Binance USDT',
    });
    expect(w.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('locks both accounts up front, ascending, whichever the direction (global lock order)', async () => {
    const { w, zelle, binance } = await world();
    await w.createTransfer.execute(
      w.owner,
      transfer(binance, zelle, { amountFrom: '10', amountTo: '10' }),
    );
    expect(w.locks.acquired.map((row) => row.id)).toEqual([zelle, binance].sort());
    expect(w.locks.acquired.every((row) => row.rowClass === 'Account')).toBe(true);
  });

  it('refuses a transfer from an account to itself (HU-16 CA2) and writes nothing', async () => {
    const { w, zelle } = await world();
    const before = w.repository.transfers.length;
    const error = await rejection(w.createTransfer.execute(w.owner, transfer(zelle, zelle)));
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { toAccountId: ['accounts.validation.sameAccount'] },
    });
    expect(w.repository.transfers).toHaveLength(before);
    expect(await balance(w, zelle)).toBe('1200.00');
  });

  it('refuses a transfer from or into an inactive account', async () => {
    const { w, zelle, binance } = await world();
    await w.updateAccount.execute(w.owner, binance, { active: false });
    const into = await rejection(w.createTransfer.execute(w.owner, transfer(zelle, binance)));
    expect(into).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { toAccountId: ['accounts.validation.inactive'] },
    });
    const from = await rejection(w.createTransfer.execute(w.owner, transfer(binance, zelle)));
    expect(from.fieldErrors).toEqual({ fromAccountId: ['accounts.validation.inactive'] });
  });

  it('answers NOT_FOUND for an unknown account', async () => {
    const { w, zelle } = await world();
    const error = await rejection(
      w.createTransfer.execute(w.owner, transfer(zelle, 'acc_missing')),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('refuses non-positive amounts, a negative fee, a bad rate and a bad date without the DTO (lesson B2)', async () => {
    const { w, zelle, binance } = await world();
    const error = await rejection(
      w.createTransfer.execute(
        w.owner,
        transfer(zelle, binance, {
          amountFrom: '0',
          amountTo: '-1',
          feeAmount: '-2',
          usdRate: '0',
          rate: 'x',
          date: '2026-13-01',
        }),
      ),
    );
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
      'amountFrom',
      'amountTo',
      'date',
      'feeAmount',
      'rate',
      'usdRate',
    ]);
    const usd = await rejection(
      w.createTransfer.execute(w.owner, transfer(zelle, binance, { usdRate: '2' })),
    );
    expect(usd.fieldErrors).toEqual({ usdRate: ['accounts.validation.usdRateMustBeOne'] });
    expect(w.repository.transfers).toHaveLength(1);
  });
});

describe('CreateMovement (ported from createMovement, PRD §8.7)', () => {
  it('stores a contribution with its partner, the USD snapshot and the activity', async () => {
    const { w, zelle } = await world();
    w.facts.length = 0;
    const created = await w.createMovement.execute(
      w.owner,
      movement(zelle, { type: 'APORTE_CAPITAL', amount: '80' }),
    );
    expect(created).toMatchObject({
      account: { id: zelle, label: 'Zelle USD', type: 'ACCOUNT' },
      type: 'APORTE_CAPITAL',
      amount: '80.00',
      amountUsd: '80.00',
      partner: { id: 'usr_andres', label: 'Andrés Molina', type: 'USER' },
      description: 'Retiro de prueba',
    });
    expect(w.facts).toContainEqual({
      sourceType: 'MOVEMENT',
      sourceId: created.id,
      kinds: ['MOVEMENT_IN'],
    });
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'CREATE',
      entityType: 'ACCOUNT_MOVEMENT',
      entityId: created.id,
      entityLabel: 'Zelle USD',
    });
    expect(w.locks.acquired).toEqual([{ rowClass: 'Account', id: zelle }]);
    expect(await balance(w, zelle)).toBe('1280.00');
  });

  it('keeps a withdrawal positive and projects it as MOVEMENT_OUT', async () => {
    const { w, zelle } = await world();
    w.facts.length = 0;
    const created = await w.createMovement.execute(w.owner, movement(zelle));
    expect(created.amount).toBe('50.00');
    expect(w.facts[0]?.kinds).toEqual(['MOVEMENT_OUT']);
    expect(await balance(w, zelle)).toBe('1150.00');
  });

  it('keeps the sign of an AJUSTE, converts it to USD with its sign and ignores a partner', async () => {
    const { w, ves } = await world();
    const created = await w.createMovement.execute(
      w.owner,
      movement(ves, {
        type: 'AJUSTE',
        amount: '-755.16',
        usdRate: '755.16',
        partnerId: 'usr_andres',
      }),
    );
    expect(created).toMatchObject({ amount: '-755.16', amountUsd: '-1.00', partner: null });
    expect(await balance(w, ves)).toBe('2744.84');
  });

  it('refuses a contribution or withdrawal whose partner is missing or unknown', async () => {
    const { w, zelle } = await world();
    for (const partnerId of [undefined, 'usr_no_existe']) {
      const error = await rejection(
        w.createMovement.execute(w.owner, movement(zelle, { partnerId })),
      );
      expect(error).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { partnerId: ['accounts.validation.partnerRequired'] },
      });
    }
    expect(w.repository.movements).toHaveLength(3);
  });

  it('refuses a zero AJUSTE, a non-positive contribution, an inactive account and bad snapshots', async () => {
    const { w, zelle, binance } = await world();
    const zero = await rejection(
      w.createMovement.execute(w.owner, movement(zelle, { type: 'AJUSTE', amount: '0.00' })),
    );
    expect(zero.fieldErrors).toEqual({ amount: ['accounts.validation.adjustmentNonZero'] });
    const negative = await rejection(
      w.createMovement.execute(w.owner, movement(zelle, { amount: '-5' })),
    );
    expect(negative.fieldErrors).toEqual({ amount: ['validation.money.mustBePositive'] });
    const bad = await rejection(
      w.createMovement.execute(w.owner, movement(zelle, { description: ' ', date: '2026-02-30' })),
    );
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(['date', 'description']);
    const usd = await rejection(
      w.createMovement.execute(w.owner, movement(zelle, { usdRate: '3' })),
    );
    expect(usd.fieldErrors).toEqual({ usdRate: ['accounts.validation.usdRateMustBeOne'] });
    await w.updateAccount.execute(w.owner, binance, { active: false });
    const inactive = await rejection(
      w.createMovement.execute(w.owner, movement(binance, { usdRate: '0.9901' })),
    );
    expect(inactive.fieldErrors).toEqual({ accountId: ['accounts.validation.inactive'] });
    expect(w.repository.movements).toHaveLength(3);
  });

  it('answers NOT_FOUND for an unknown account', async () => {
    const { w } = await world();
    const error = await rejection(w.createMovement.execute(w.owner, movement('acc_missing')));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('access', () => {
  it.each(['member', 'viewer'] as const)('refuses %s on transfers and movements', async (role) => {
    const { w, zelle, binance } = await world();
    const actor = w[role];
    expect((await rejection(w.createTransfer.execute(actor, transfer(zelle, binance)))).code).toBe(
      'FORBIDDEN',
    );
    expect((await rejection(w.createMovement.execute(actor, movement(zelle)))).code).toBe(
      'FORBIDDEN',
    );
    expect(await balance(w, zelle)).toBe('1200.00');
  });
});
