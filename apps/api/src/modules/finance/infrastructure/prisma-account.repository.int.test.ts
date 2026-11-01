import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorld,
  catalogIds,
  seedClient,
  seedExpense,
  seedPayment,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import type {
  AccountRepository,
  LedgerFilter,
  NewAccount,
} from '../application/ports/account.repository.port';
import { accountBalance } from '../domain/accounts';
import { PrismaAccountRepository } from './prisma-account.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const world = buildWorld(service);
const repository: AccountRepository = new PrismaAccountRepository(world.host);
const inTx = <T>(work: () => Promise<T>) => world.uow.run(work);

const account = (over: Partial<NewAccount> & { id: string }): NewAccount => ({
  name: over.id,
  type: 'BANCO_INTERNACIONAL',
  institution: null,
  currency: 'USD',
  identifierMasked: null,
  holderName: null,
  openingBalance: '0.00',
  openingDate: '2026-01-01',
  active: true,
  notes: null,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
  ...over,
});

const ledgerFilter = (accountId: string, over: Partial<LedgerFilter> = {}): LedgerFilter => ({
  accountId,
  sort: { field: 'date', direction: 'asc' },
  page: 1,
  pageSize: 100,
  ...over,
});

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaAccountRepository records (int)', () => {
  it('inserts, finds and updates an account, mapping money and dates to strings', async () => {
    await inTx(() =>
      repository.insert(
        account({
          id: 'acc_a',
          name: 'Zelle',
          institution: 'Zelle',
          identifierMasked: 'cobr…test',
          openingBalance: '1000.50',
          openingDate: '2026-02-03',
        }),
      ),
    );
    expect(await repository.find('acc_a')).toMatchObject({
      id: 'acc_a',
      name: 'Zelle',
      identifierMasked: 'cobr…test',
      openingBalance: '1000.50',
      openingDate: '2026-02-03',
      balance: '0.00',
      active: true,
      createdAt: '2026-01-01T10:00:00.000Z',
    });
    await inTx(() =>
      repository.update('acc_a', {
        name: 'Zelle 2',
        institution: null,
        active: false,
        updatedAt: '2026-03-01T10:00:00.000Z',
      }),
    );
    expect(await repository.find('acc_a')).toMatchObject({
      name: 'Zelle 2',
      institution: null,
      active: false,
      identifierMasked: 'cobr…test',
      updatedAt: '2026-03-01T10:00:00.000Z',
    });
    expect(await repository.find('acc_missing')).toBeNull();
  });

  it('does not return an archived account', async () => {
    await inTx(() => repository.insert(account({ id: 'acc_gone' })));
    await admin.account.update({ where: { id: 'acc_gone' }, data: { deletedAt: new Date() } });
    expect(await repository.find('acc_gone')).toBeNull();
  });

  it('lists active accounts by default with facets, text search, numeric balance sort and paging', async () => {
    await inTx(async () => {
      await repository.insert(
        account({ id: 'acc_1', name: 'Banco Ñandú', currency: 'VES', type: 'BANCO_NACIONAL' }),
      );
      await repository.insert(
        account({ id: 'acc_2', name: 'Zelle', currency: 'USD', type: 'BILLETERA_DIGITAL' }),
      );
      await repository.insert(
        account({
          id: 'acc_3',
          name: 'Binance',
          currency: 'USDT',
          type: 'WALLET_CRIPTO',
          active: false,
        }),
      );
    });
    await admin.account.update({ where: { id: 'acc_1' }, data: { balance: '9.00' } });
    await admin.account.update({ where: { id: 'acc_2' }, data: { balance: '100.00' } });
    const base = {
      page: 1,
      pageSize: 25,
      sort: { field: 'name', direction: 'asc' as const },
      includeInactive: false,
    };
    const ids = async (over: Partial<Parameters<AccountRepository['list']>[0]>) =>
      (await repository.list({ ...base, ...over })).items.map((a) => a.id);
    expect(await ids({})).toEqual(['acc_1', 'acc_2']);
    expect(await ids({ includeInactive: true })).toEqual(['acc_1', 'acc_3', 'acc_2']);
    expect(await ids({ statuses: ['inactive'] })).toEqual(['acc_3']);
    expect(await ids({ statuses: ['inactive'], includeInactive: false })).toEqual(['acc_3']);
    expect(
      await ids({ types: ['WALLET_CRIPTO', 'BANCO_NACIONAL'], includeInactive: true }),
    ).toEqual(['acc_1', 'acc_3']);
    expect(await ids({ currencies: ['USD'] })).toEqual(['acc_2']);
    expect(await ids({ q: 'nandu' })).toEqual(['acc_1']);
    expect(await ids({ sort: { field: 'balance', direction: 'desc' } })).toEqual([
      'acc_2',
      'acc_1',
    ]);
    const page = await repository.list({ ...base, pageSize: 1, page: 2 });
    expect(page).toMatchObject({ total: 2, page: 2, pageCount: 2 });
    expect(page.items.map((a) => a.id)).toEqual(['acc_2']);
  });

  it('reports movements from payments, expenses, transfers and movements, archived ones included', async () => {
    await inTx(async () => {
      for (const id of ['acc_p', 'acc_e', 'acc_t', 'acc_t2', 'acc_m', 'acc_none']) {
        await repository.insert(account({ id }));
      }
    });
    await seedClient(world.host.db, 'cli_a');
    const { methodId, categoryId } = await catalogIds(world.host.db);
    await seedPayment(world.host.db, {
      id: 'pay_a',
      clientId: 'cli_a',
      accountId: 'acc_p',
      methodId,
      amount: '10.00',
      archived: true,
    });
    await seedExpense(world.host.db, {
      id: 'exp_a',
      accountId: 'acc_e',
      categoryId,
      amount: '5.00',
    });
    await inTx(async () => {
      await repository.insertTransfer({
        id: 'trf_a',
        date: '2026-02-01',
        fromAccountId: 'acc_t',
        toAccountId: 'acc_t2',
        amountFrom: '1.00',
        amountTo: '1.00',
        feeAmount: '0.00',
        rate: null,
        amountUsd: '1.00',
        reference: null,
        notes: null,
        createdAt: '2026-02-01T10:00:00.000Z',
        createdById: null,
      });
      await repository.insertMovement({
        id: 'mov_a',
        accountId: 'acc_m',
        type: 'AJUSTE',
        date: '2026-02-01',
        amount: '-1.00',
        amountUsd: '-1.00',
        partnerId: null,
        description: 'x',
        createdAt: '2026-02-01T10:00:00.000Z',
        createdById: null,
      });
    });
    for (const id of ['acc_p', 'acc_e', 'acc_t', 'acc_t2', 'acc_m']) {
      expect(await repository.hasMovements(id), id).toBe(true);
    }
    expect(await repository.hasMovements('acc_none')).toBe(false);
  });

  it('stores a reconciliation without touching the balance', async () => {
    await inTx(async () => {
      await repository.insert(account({ id: 'acc_r', openingBalance: '10.00' }));
      await repository.insertReconciliation({
        id: 'rec_a',
        accountId: 'acc_r',
        date: '2026-03-01',
        statementBalance: '12.00',
        systemBalance: '10.00',
        difference: '2.00',
        notes: 'n',
        createdAt: '2026-03-01T10:00:00.000Z',
        createdById: null,
      });
    });
    const row = await admin.accountReconciliation.findUniqueOrThrow({ where: { id: 'rec_a' } });
    expect(row).toMatchObject({ notes: 'n' });
    expect(row.difference.toFixed(2)).toBe('2.00');
    expect(
      (await admin.account.findUniqueOrThrow({ where: { id: 'acc_r' } })).balance.toFixed(2),
    ).toBe('0.00');
  });
});

describe('PrismaAccountRepository ledger over account_ledger_v (int)', () => {
  /** Zelle-like account: 1000 opening, payment 500 (net 490), expense 200, transfers, a RETIRO_SOCIO. */
  async function seedLedger() {
    await inTx(async () => {
      await repository.insert(account({ id: 'acc_l', name: 'Ledger', openingBalance: '1000.00' }));
      await repository.insert(account({ id: 'acc_o', name: 'Other', currency: 'USDT' }));
    });
    await seedClient(world.host.db, 'cli_a');
    const { methodId, categoryId } = await catalogIds(world.host.db);
    await seedPayment(world.host.db, {
      id: 'pay_l',
      clientId: 'cli_a',
      accountId: 'acc_l',
      methodId,
      amount: '500.00',
      feeAmount: '10.00',
      date: '2026-02-01',
    });
    await seedExpense(world.host.db, {
      id: 'exp_l',
      accountId: 'acc_l',
      categoryId,
      amount: '200.00',
      paidAt: '2026-03-01',
      date: '2026-02-20',
    });
    // A pending payment and an annulled expense never reach the ledger.
    await seedPayment(world.host.db, {
      id: 'pay_pending',
      clientId: 'cli_a',
      accountId: 'acc_l',
      methodId,
      amount: '77.00',
      status: 'PENDIENTE_VERIFICACION',
    });
    await seedExpense(world.host.db, {
      id: 'exp_void',
      accountId: 'acc_l',
      categoryId,
      amount: '33.00',
      status: 'ANULADO',
    });
    await inTx(async () => {
      await repository.insertTransfer({
        id: 'trf_out',
        date: '2026-04-01',
        fromAccountId: 'acc_l',
        toAccountId: 'acc_o',
        amountFrom: '100.00',
        amountTo: '99.00',
        feeAmount: '2.00',
        rate: null,
        amountUsd: '100.00',
        reference: 'REF-9',
        notes: 'to binance',
        createdAt: '2026-04-01T10:00:00.000Z',
        createdById: null,
      });
      await repository.insertMovement({
        id: 'mov_in',
        accountId: 'acc_l',
        type: 'APORTE_CAPITAL',
        date: '2026-05-01',
        amount: '300.00',
        amountUsd: '300.00',
        partnerId: null,
        description: 'aporte',
        createdAt: '2026-05-01T10:00:00.000Z',
        createdById: null,
      });
      await repository.insertMovement({
        id: 'mov_out',
        accountId: 'acc_l',
        type: 'RETIRO_SOCIO',
        date: '2026-06-01',
        amount: '50.00',
        amountUsd: '50.00',
        partnerId: null,
        description: 'retiro',
        createdAt: '2026-06-01T10:00:00.000Z',
        createdById: null,
      });
      await repository.insertMovement({
        id: 'mov_adj',
        accountId: 'acc_l',
        type: 'AJUSTE',
        date: '2026-06-02',
        amount: '-5.00',
        amountUsd: '-5.00',
        partnerId: null,
        description: 'ajuste',
        createdAt: '2026-06-02T10:00:00.000Z',
        createdById: null,
      });
      await world.projector.projectAccount('acc_l');
      await world.projector.projectAccount('acc_o');
    });
  }

  it('lists the signed entries in date order with the running balance and the identity of each source', async () => {
    await seedLedger();
    const ledger = await repository.ledger(ledgerFilter('acc_l'));
    expect(ledger.items.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['OPENING_BALANCE', '1000.00', '1000.00'],
      ['PAYMENT', '490.00', '1490.00'],
      ['EXPENSE', '-200.00', '1290.00'],
      ['TRANSFER_OUT', '-102.00', '1188.00'],
      ['APORTE_CAPITAL', '300.00', '1488.00'],
      ['RETIRO_SOCIO', '-50.00', '1438.00'],
      ['AJUSTE', '-5.00', '1433.00'],
    ]);
    expect(ledger.items[0]).toMatchObject({
      id: 'opening:acc_l',
      date: '2026-01-01',
      source: null,
    });
    expect(ledger.items[1]).toMatchObject({
      id: 'pay_l',
      source: { type: 'PAYMENT', id: 'pay_l' },
    });
    expect(ledger.items[2]?.source).toMatchObject({ type: 'EXPENSE', id: 'exp_l' });
    expect(ledger.items[3]).toMatchObject({
      source: { type: 'TRANSFER', id: 'trf_out', label: 'REF-9' },
      description: 'to binance',
    });
    expect(ledger.items[4]).toMatchObject({
      source: { type: 'ACCOUNT_MOVEMENT', id: 'mov_in', label: 'aporte' },
      description: 'aporte',
    });
    const other = await repository.ledger(ledgerFilter('acc_o'));
    expect(other.items.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['OPENING_BALANCE', '0.00', '0.00'],
      ['TRANSFER_IN', '99.00', '99.00'],
    ]);
  });

  it('ends on Account.balance, which equals the §9.7 calculation, incl. a RETIRO_SOCIO', async () => {
    await seedLedger();
    const ledger = await repository.ledger(ledgerFilter('acc_l'));
    const cached = (
      await admin.account.findUniqueOrThrow({ where: { id: 'acc_l' } })
    ).balance.toFixed(2);
    const source = await world.sources.accountSource('acc_l');
    expect(ledger.items.at(-1)?.balance).toBe('1433.00');
    expect(cached).toBe('1433.00');
    expect(accountBalance((source as NonNullable<typeof source>).activity, '9999-12-31')).toBe(
      '1433.00',
    );
  });

  it('filters by kind and date range and pages them without changing the running balance', async () => {
    await seedLedger();
    const outs = await repository.ledger(
      ledgerFilter('acc_l', { kinds: ['RETIRO_SOCIO', 'TRANSFER_OUT'] }),
    );
    expect(outs.items.map((r) => [r.kind, r.balance])).toEqual([
      ['TRANSFER_OUT', '1188.00'],
      ['RETIRO_SOCIO', '1438.00'],
    ]);
    const ranged = await repository.ledger(
      ledgerFilter('acc_l', { dateFrom: '2026-04-01', dateTo: '2026-05-31' }),
    );
    expect(ranged.items.map((r) => [r.kind, r.balance])).toEqual([
      ['TRANSFER_OUT', '1188.00'],
      ['APORTE_CAPITAL', '1488.00'],
    ]);
    const paged = await repository.ledger(ledgerFilter('acc_l', { pageSize: 2, page: 2 }));
    expect(paged).toMatchObject({ total: 7, page: 2, pageCount: 4 });
    expect(paged.items.map((r) => r.kind)).toEqual(['EXPENSE', 'TRANSFER_OUT']);
  });

  it('sorts by amount and balance in either direction and searches the description', async () => {
    await seedLedger();
    const byAmount = await repository.ledger(
      ledgerFilter('acc_l', { sort: { field: 'amount', direction: 'desc' } }),
    );
    expect(byAmount.items.map((r) => r.amount)).toEqual([
      '1000.00',
      '490.00',
      '300.00',
      '-5.00',
      '-50.00',
      '-102.00',
      '-200.00',
    ]);
    const byBalance = await repository.ledger(
      ledgerFilter('acc_l', { sort: { field: 'balance', direction: 'asc' } }),
    );
    expect(byBalance.items.map((r) => r.balance)).toEqual([
      '1000.00',
      '1188.00',
      '1290.00',
      '1433.00',
      '1438.00',
      '1488.00',
      '1490.00',
    ]);
    const found = await repository.ledger(ledgerFilter('acc_l', { q: 'APORTE' }));
    expect(found.items.map((r) => r.kind)).toEqual(['APORTE_CAPITAL']);
  });

  it('keeps entries of other accounts and archived rows out of the ledger', async () => {
    await seedLedger();
    await admin.accountMovement.update({
      where: { id: 'mov_adj' },
      data: { deletedAt: new Date() },
    });
    const ledger = await repository.ledger(ledgerFilter('acc_l'));
    expect(ledger.items.map((r) => r.kind)).not.toContain('AJUSTE');
    expect(ledger.items.at(-1)?.balance).toBe('1438.00');
  });
});
