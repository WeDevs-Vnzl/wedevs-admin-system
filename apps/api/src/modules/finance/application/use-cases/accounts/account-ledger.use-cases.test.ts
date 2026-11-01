import { describe, expect, it } from 'vitest';
import {
  createWorld,
  NOW,
  query,
  rejection,
  type World,
} from '../../../../../../test/finance/accounts/world';

/** Zelle 1000 + a payment of 500 on 02-01 − an expense of 200 on 03-01 = 1300. */
async function zelleWithEntries(w: World) {
  const { id } = await w.createAccount.execute(w.owner, {
    name: 'Zelle USD',
    type: 'BILLETERA_DIGITAL',
    currency: 'USD',
    openingBalance: '1000.00',
    openingDate: '2026-01-01',
  });
  w.repository.addExternal({
    id: 'pay_1',
    accountId: id,
    date: '2026-02-01',
    amount: '500.00',
    kind: 'PAYMENT',
    code: 'PAG-1',
  });
  w.repository.addExternal({
    id: 'exp_1',
    accountId: id,
    date: '2026-03-01',
    amount: '200.00',
    kind: 'EXPENSE',
    code: 'GAS-1',
  });
  return id;
}

describe('GetAccountLedger (ported from getAccountLedger, HU-15 CA2)', () => {
  it('lists every entry in date order with the running balance after it', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    const ledger = await w.getLedger.execute(w.owner, id, query({ pageSize: 100 }));
    expect(ledger.items.map((row) => [row.kind, row.amount, row.balance])).toEqual([
      ['OPENING_BALANCE', '1000.00', '1000.00'],
      ['PAYMENT', '500.00', '1500.00'],
      ['EXPENSE', '-200.00', '1300.00'],
    ]);
  });

  it('filters narrow the rows without changing their running balance', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    const filtered = await w.getLedger.execute(
      w.owner,
      id,
      query({ pageSize: 100, filters: { kind: 'EXPENSE' } }),
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.balance).toBe('1300.00');
    const ranged = await w.getLedger.execute(
      w.owner,
      id,
      query({ filters: { dateFrom: '2026-02-01', dateTo: '2026-02-28' } }),
    );
    expect(ranged.items.map((row) => row.kind)).toEqual(['PAYMENT']);
  });

  it('ends on the cached account balance (§9.7)', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    const ledger = await w.getLedger.execute(w.owner, id, query({ pageSize: 100 }));
    expect(ledger.items.at(-1)?.balance).toBe(w.computedBalance(id));
  });

  it('answers NOT_FOUND for an unknown account and VALIDATION for a bad filter', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    expect((await rejection(w.getLedger.execute(w.owner, 'acc_missing', query()))).code).toBe(
      'NOT_FOUND',
    );
    const kind = await rejection(
      w.getLedger.execute(w.owner, id, query({ filters: { kind: 'NOPE' } })),
    );
    expect(kind).toMatchObject({ code: 'VALIDATION', fieldErrors: { kind: expect.any(Array) } });
    const date = await rejection(
      w.getLedger.execute(w.owner, id, query({ filters: { dateFrom: '2026-13-01' } })),
    );
    expect(date.fieldErrors).toHaveProperty('dateFrom');
    const sort = await rejection(
      w.getLedger.execute(w.owner, id, query({ sort: { field: 'x', direction: 'asc' } })),
    );
    expect(sort.fieldErrors).toHaveProperty('sort');
  });
});

describe('GetAccountBalance (getAccountBalance(at), Q-BE3-3)', () => {
  it('answers the balance at the end of a date, today when omitted', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    expect(await w.getBalance.execute(w.owner, id, { at: '2026-02-15' })).toMatchObject({
      accountId: id,
      currency: 'USD',
      at: '2026-02-15',
      balance: '1500.00',
      balanceUsd: '1500.00',
    });
    expect(await w.getBalance.execute(w.owner, id, {})).toMatchObject({
      at: '2026-10-09',
      balance: '1300.00',
    });
    expect((await w.getBalance.execute(w.owner, id, { at: '2025-12-31' })).balance).toBe('1000.00');
  });

  it('refuses a malformed date and an unknown account', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    expect(
      (await rejection(w.getBalance.execute(w.owner, id, { at: '2026-02-30' }))).fieldErrors,
    ).toHaveProperty('at');
    expect((await rejection(w.getBalance.execute(w.owner, 'acc_missing', {}))).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('ReconcileAccount (ported from reconcileAccount, HU-15 CA3, Q-BE3-5)', () => {
  it('a difference suggests an AJUSTE for that amount, is persisted and does not touch the balance', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    const result = await w.reconcile.execute(w.owner, id, {
      date: '2026-10-09',
      statementBalance: '1400.00',
      notes: 'Extracto de octubre',
    });
    expect(result).toMatchObject({
      accountId: id,
      date: '2026-10-09',
      statementBalance: '1400.00',
      systemBalance: '1300.00',
      difference: '100.00',
      suggestedAdjustment: '100.00',
      notes: 'Extracto de octubre',
      createdAt: NOW,
    });
    expect(w.repository.reconciliations).toEqual([
      expect.objectContaining({
        id: result.id,
        accountId: id,
        difference: '100.00',
        createdById: w.owner.userId,
      }),
    ]);
    expect(w.repository.accounts[0]?.balance).toBe('1000.00');
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'CREATE',
      entityType: 'ACCOUNT',
      entityId: id,
      metadata: { reconciliationId: result.id, difference: '100.00' },
    });
    expect(w.locks.acquired).toEqual([{ rowClass: 'Account', id }]);
  });

  it('a matching statement suggests no adjustment, and a negative difference a negative one', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    const match = await w.reconcile.execute(w.owner, id, {
      date: '2026-10-09',
      statementBalance: '1300.00',
    });
    expect(match).toMatchObject({ difference: '0.00', suggestedAdjustment: null });
    const less = await w.reconcile.execute(w.owner, id, {
      date: '2026-02-15',
      statementBalance: '1400.00',
    });
    expect(less).toMatchObject({
      systemBalance: '1500.00',
      difference: '-100.00',
      suggestedAdjustment: '-100.00',
    });
  });

  it('refuses invalid input and an unknown account, and writes nothing', async () => {
    const w = createWorld();
    const id = await zelleWithEntries(w);
    const bad = await rejection(
      w.reconcile.execute(w.owner, id, { date: 'nope', statementBalance: '1.234' }),
    );
    expect(bad.fieldErrors).toMatchObject({
      date: expect.any(Array),
      statementBalance: expect.any(Array),
    });
    expect(
      (
        await rejection(
          w.reconcile.execute(w.owner, 'acc_missing', {
            date: '2026-10-09',
            statementBalance: '1',
          }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(w.repository.reconciliations).toHaveLength(0);
  });
});
