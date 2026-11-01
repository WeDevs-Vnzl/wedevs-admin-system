import { describe, expect, it } from 'vitest';
import { createWorld, NOW, query, rejection } from '../../../../../../test/finance/accounts/world';

const base = {
  name: 'Banco de prueba',
  type: 'BANCO_NACIONAL' as const,
  currency: 'VES',
  openingDate: '2026-01-01',
};

const zelle = {
  name: 'Zelle USD',
  type: 'BILLETERA_DIGITAL' as const,
  currency: 'USD',
  openingBalance: '1000.00',
  openingDate: '2026-01-01',
  identifierMasked: 'cobros@example.test',
};

describe('CreateAccount (ported from createAccount, PRD §8.7)', () => {
  it('stores the account with the opening as its cached balance, a search entry and one CREATE', async () => {
    const w = createWorld();
    const created = await w.createAccount.execute(w.owner, zelle);
    expect(created).toMatchObject({
      name: 'Zelle USD',
      currency: 'USD',
      active: true,
      openingBalance: '1000.00',
      balance: '1000.00',
      balanceUsd: '1000.00',
      createdAt: NOW,
    });
    expect(w.repository.accounts).toHaveLength(1);
    expect(w.search.get('ACCOUNT', created.id)).toMatchObject({
      title: 'Zelle USD',
      status: 'active',
    });
    expect(w.activity.entries).toEqual([
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'ACCOUNT',
        entityId: created.id,
        actor: { actorType: 'USER', userId: w.owner.userId },
      }),
    ]);
  });

  it('masks the identifier whatever the caller sends: the full number is never stored or returned (C5)', async () => {
    const w = createWorld();
    const created = await w.createAccount.execute(w.admin, {
      ...base,
      identifierMasked: '0102-0123-45-6789012345',
    });
    expect(created.identifierMasked).toBe('•••• 2345');
    expect(JSON.stringify([w.repository.accounts, w.activity.entries])).not.toContain('6789012345');
    const wallet = await w.createAccount.execute(w.admin, {
      ...base,
      identifierMasked: 'cobros@example.test',
    });
    expect(wallet.identifierMasked).toBe('cobr…test');
  });

  it('values the balance in USD at the rate of the day, and has none while the currency has no rate', async () => {
    const w = createWorld();
    const withRate = await w.createAccount.execute(w.owner, { ...base, openingBalance: '755.16' });
    expect(withRate.balanceUsd).toBe('1.00');
    const noRate = await w.createAccount.execute(w.owner, { ...base, currency: 'GBP' });
    expect(noRate.balanceUsd).toBeNull();
  });

  it('refuses invalid input as VALIDATION without the DTO and writes nothing (lesson B2)', async () => {
    const w = createWorld();
    const error = await rejection(
      w.createAccount.execute(w.owner, {
        name: '   ',
        type: 'NOPE' as never,
        currency: 'abc',
        openingBalance: '1.234',
        openingDate: '2026-02-30',
      }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
      'currency',
      'name',
      'openingBalance',
      'openingDate',
      'type',
    ]);
    expect(w.repository.accounts).toHaveLength(0);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('refuses a currency outside the catalog', async () => {
    const w = createWorld();
    const error = await rejection(w.createAccount.execute(w.owner, { ...base, currency: 'XYZ' }));
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { currency: ['accounts.validation.unknownCurrency'] },
    });
  });
});

describe('UpdateAccount (ported from updateAccount)', () => {
  it('edits only what is sent, locks the account row first and logs the changed fields', async () => {
    const w = createWorld();
    const { id } = await w.createAccount.execute(w.owner, zelle);
    const updated = await w.updateAccount.execute(w.admin, id, { name: 'Zelle principal' });
    expect(updated).toMatchObject({ name: 'Zelle principal', identifierMasked: 'cobr…test' });
    expect(w.locks.acquired).toEqual([{ rowClass: 'Account', id }]);
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'UPDATE',
      changes: { name: ['Zelle USD', 'Zelle principal'] },
    });
  });

  it('keeps the stored identifier for a blank one, clears it for null and re-masks a new one', async () => {
    const w = createWorld();
    const { id } = await w.createAccount.execute(w.owner, zelle);
    expect(
      (await w.updateAccount.execute(w.owner, id, { identifierMasked: '' })).identifierMasked,
    ).toBe('cobr…test');
    expect(
      (await w.updateAccount.execute(w.owner, id, { identifierMasked: '0102012345678901' }))
        .identifierMasked,
    ).toBe('•••• 8901');
    expect(
      (await w.updateAccount.execute(w.owner, id, { identifierMasked: null })).identifierMasked,
    ).toBeNull();
  });

  it('logs nothing when the edit changes nothing', async () => {
    const w = createWorld();
    const { id } = await w.createAccount.execute(w.owner, zelle);
    await w.updateAccount.execute(w.owner, id, { name: 'Zelle USD' });
    expect(w.activity.entries).toHaveLength(1);
  });

  it('locks the currency once the account has movements, and lets it change before', async () => {
    const w = createWorld();
    const { id } = await w.createAccount.execute(w.owner, zelle);
    expect((await w.updateAccount.execute(w.owner, id, { currency: 'EUR' })).currency).toBe('EUR');
    w.repository.addExternal({
      id: 'pay_1',
      accountId: id,
      date: '2026-02-01',
      amount: '10.00',
      kind: 'PAYMENT',
      code: 'PAG-1',
    });
    const error = await rejection(w.updateAccount.execute(w.owner, id, { currency: 'USD' }));
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { currency: ['accounts.validation.currencyLocked'] },
    });
    expect(
      (await w.updateAccount.execute(w.owner, id, { currency: 'EUR', name: 'Zelle' })).name,
    ).toBe('Zelle');
  });

  it('recomputes the cached balance when the opening changes and can deactivate an account with movements', async () => {
    const w = createWorld();
    const { id } = await w.createAccount.execute(w.owner, zelle);
    w.repository.addExternal({
      id: 'pay_1',
      accountId: id,
      date: '2026-02-01',
      amount: '10.00',
      kind: 'PAYMENT',
      code: 'PAG-1',
    });
    const updated = await w.updateAccount.execute(w.owner, id, {
      openingBalance: '2000.00',
      active: false,
    });
    expect(updated).toMatchObject({ active: false, openingBalance: '2000.00', balance: '2010.00' });
    expect(w.search.get('ACCOUNT', id)?.status).toBe('inactive');
  });

  it('answers NOT_FOUND for an unknown account and writes nothing', async () => {
    const w = createWorld();
    const error = await rejection(w.updateAccount.execute(w.owner, 'acc_missing', { name: 'x' }));
    expect(error.code).toBe('NOT_FOUND');
    expect(w.activity.entries).toHaveLength(0);
  });

  it('refuses invalid fields as VALIDATION', async () => {
    const w = createWorld();
    const { id } = await w.createAccount.execute(w.owner, zelle);
    const error = await rejection(
      w.updateAccount.execute(w.owner, id, { name: '', openingBalance: 'abc' }),
    );
    expect(error.fieldErrors).toMatchObject({
      name: expect.any(Array),
      openingBalance: expect.any(Array),
    });
  });
});

describe('GetAccount and ListAccounts (ported from getAccount and listAccounts)', () => {
  it('values the USDT balance in USD at 1 USDT = 1.01 USD (99 ÷ 0.9901 = 99.99)', async () => {
    const w = createWorld();
    const { id } = await w.createAccount.execute(w.owner, {
      ...base,
      currency: 'USDT',
      openingBalance: '99.00',
    });
    expect((await w.getAccount.execute(w.owner, id)).balanceUsd).toBe('99.99');
  });

  it('answers NOT_FOUND for an unknown account', async () => {
    const w = createWorld();
    expect((await rejection(w.getAccount.execute(w.owner, 'acc_missing'))).code).toBe('NOT_FOUND');
  });

  it('lists active accounts only unless inactive ones are requested', async () => {
    const w = createWorld();
    const a = await w.createAccount.execute(w.owner, base);
    const b = await w.createAccount.execute(w.owner, { ...base, name: 'Otra', active: false });
    const ids = async (filters: Record<string, string | string[]>) =>
      (await w.listAccounts.execute(w.owner, query({ pageSize: 100, filters }))).items.map(
        (item) => item.id,
      );
    expect(await ids({})).toEqual([a.id]);
    expect((await ids({ includeInactive: 'true' })).sort()).toEqual([a.id, b.id].sort());
    expect(await ids({ status: 'inactive' })).toEqual([b.id]);
    expect(await ids({ status: 'inactive', includeInactive: 'false' })).toEqual([b.id]);
  });

  it('filters by type and currency and sorts balances numerically', async () => {
    const w = createWorld();
    const ves = await w.createAccount.execute(w.owner, { ...base, openingBalance: '5000.00' });
    const usd = await w.createAccount.execute(w.owner, { ...zelle, openingBalance: '900.00' });
    const crypto = await w.createAccount.execute(w.owner, {
      ...base,
      name: 'Binance',
      type: 'WALLET_CRIPTO',
      currency: 'USDT',
      openingBalance: '99.00',
    });
    const ids = async (over: Parameters<typeof query>[0]) =>
      (await w.listAccounts.execute(w.owner, query({ pageSize: 100, ...over }))).items.map(
        (item) => item.id,
      );
    expect(await ids({ filters: { type: 'WALLET_CRIPTO' } })).toEqual([crypto.id]);
    expect(
      await ids({
        filters: { currency: ['USD', 'VES'] },
        sort: { field: 'balance', direction: 'desc' },
      }),
    ).toEqual([ves.id, usd.id]);
  });

  it('rejects a sort field outside the whitelist as VALIDATION', async () => {
    const w = createWorld();
    const error = await rejection(
      w.listAccounts.execute(w.owner, query({ sort: { field: 'holderName', direction: 'asc' } })),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { sort: ['validation.sort.invalid'] },
    });
  });
});

describe('ListAccountPartners', () => {
  it('lists the users who can be a partner', async () => {
    const w = createWorld();
    expect((await w.listPartners.execute(w.owner)).map((partner) => partner.id)).toEqual([
      'usr_andres',
      'usr_laura',
    ]);
  });
});

describe('access (PRD §4.3: Member and Viewer get FORBIDDEN on every finance use case)', () => {
  it.each(['member', 'viewer'] as const)(
    'refuses %s everywhere and writes nothing',
    async (role) => {
      const w = createWorld();
      const { id } = await w.createAccount.execute(w.owner, base);
      const actor = w[role];
      const calls: Promise<unknown>[] = [
        w.createAccount.execute(actor, base),
        w.updateAccount.execute(actor, id, { name: 'x' }),
        w.getAccount.execute(actor, id),
        w.listAccounts.execute(actor, query()),
        w.getLedger.execute(actor, id, query()),
        w.getBalance.execute(actor, id, {}),
        w.reconcile.execute(actor, id, { date: '2026-10-09', statementBalance: '1.00' }),
        w.listPartners.execute(actor),
      ];
      for (const call of calls) expect((await rejection(call)).code).toBe('FORBIDDEN');
      expect(w.repository.accounts).toHaveLength(1);
      expect(w.repository.reconciliations).toHaveLength(0);
      expect(w.activity.entries).toHaveLength(1);
    },
  );
});
