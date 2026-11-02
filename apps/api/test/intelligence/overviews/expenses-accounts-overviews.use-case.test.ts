import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/shared/domain/domain-error';
import type { AccountOutput } from '../../../src/modules/finance/application/use-cases/accounts/account-support';
import type { ExpenseOutput } from '../../../src/modules/finance/application/use-cases/expenses/expense-support';
import { GetAccountsOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-accounts-overview.use-case';
import { GetExpensesOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-expenses-overview.use-case';
import { authorization, FakeListSource, userOf, world } from './world';

const expense = (id: string) => ({ id, code: id }) as unknown as ExpenseOutput;
const account = (id: string, extra: Partial<AccountOutput>) =>
  ({ id, name: id, active: true, balance: '0.00', balanceUsd: null, ...extra }) as AccountOutput;

describe('GetExpensesOverview', () => {
  function build() {
    const w = world();
    const expenses = new FakeListSource<ExpenseOutput>();
    return {
      ...w,
      expenses,
      useCase: new GetExpensesOverview(authorization, w.facts, w.overview, expenses, w.clock),
    };
  }

  it('stacks the paid spend by root category over the last six months', async () => {
    const { facts, overview: read, useCase } = build();
    facts.addCategory('root_a');
    facts.addCategory('leaf_a', 'root_a');
    facts.addCategory('root_b');
    read.categories.set('root_a', 'Infraestructura');
    read.categories.set('root_b', 'Comisiones');
    const paid = (categoryId: string, amountUsd: string, date: string) =>
      facts.addFact({ kind: 'EXPENSE_PAID', amountUsd, date, categoryId });
    paid('leaf_a', '1.10', '2026-05-02');
    paid('root_a', '0.20', '2026-10-15');
    paid('root_b', '2.38', '2026-09-30');
    // The seventh month back, and a month that has not begun, are outside the window.
    paid('root_b', '50.00', '2026-04-30');
    paid('root_b', '50.00', '2026-11-01');

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.byMonthAndCategory.periods).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(overview.byMonthAndCategory.series).toEqual([
      {
        id: 'root_b',
        label: 'Comisiones',
        values: ['0.00', '0.00', '0.00', '0.00', '2.38', '0.00'],
      },
      {
        id: 'root_a',
        label: 'Infraestructura',
        values: ['1.10', '0.00', '0.00', '0.00', '0.00', '0.20'],
      },
    ]);
    expect(overview.byCategory).toEqual([
      { key: 'root_b', label: 'Comisiones', value: '2.38' },
      { key: 'root_a', label: 'Infraestructura', value: '1.30' },
    ]);
  });

  it('commits the monthly recurring spend as the read port sums the stored snapshots (DT-100)', async () => {
    const { overview: read, useCase } = build();
    read.committed = '30.00';
    expect((await useCase.execute(userOf('ADMIN'))).committedMonthly).toBe('30.00');
  });

  it('lists the five pending expenses due first, overdue ones included', async () => {
    const { expenses, useCase } = build();
    expenses.items = Array.from({ length: 7 }, (_, i) => expense(`e${i}`));

    const overview = await useCase.execute(userOf('OWNER'));

    expect(expenses.queries[0]?.query).toMatchObject({
      sort: { field: 'dueDate', direction: 'asc' },
      filters: { status: ['PENDIENTE'] },
    });
    expect(overview.upcoming.map((row) => row.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
  });

  it.each(['MEMBER', 'VIEWER'] as const)(
    '%s is forbidden before any read (DT-175)',
    async (role) => {
      const { expenses, useCase } = build();
      await expect(useCase.execute(userOf(role))).rejects.toBeInstanceOf(ForbiddenError);
      expect(expenses.queries).toEqual([]);
    },
  );
});

describe('GetAccountsOverview', () => {
  function build() {
    const accounts = new FakeListSource<AccountOutput>();
    return { accounts, useCase: new GetAccountsOverview(authorization, accounts) };
  }

  it('lists every account, inactive ones too, and totals the USD balance of the active ones', async () => {
    const { accounts, useCase } = build();
    accounts.items = [
      account('a', { balanceUsd: '100.10' }),
      account('b', { balanceUsd: '0.20' }),
      account('inactive', { active: false, balanceUsd: '999.00' }),
      account('norate', { balanceUsd: null }),
    ];

    const overview = await useCase.execute(userOf('OWNER'));

    expect(accounts.queries[0]?.query.filters).toEqual({ includeInactive: 'true' });
    expect(overview.accounts.map((a) => a.id)).toEqual(['a', 'b', 'inactive', 'norate']);
    expect(overview.totalBalanceUsd).toBe('100.30');
  });

  it('walks every page of the list', async () => {
    const { accounts, useCase } = build();
    accounts.items = Array.from({ length: 130 }, (_, i) =>
      account(`a${i}`, { balanceUsd: '1.00' }),
    );
    const overview = await useCase.execute(userOf('ADMIN'));
    expect(overview.accounts).toHaveLength(130);
    expect(overview.totalBalanceUsd).toBe('130.00');
  });

  it('is an empty total for no accounts', async () => {
    const { useCase } = build();
    expect(await useCase.execute(userOf('OWNER'))).toEqual({
      accounts: [],
      totalBalanceUsd: '0.00',
    });
  });

  it.each(['MEMBER', 'VIEWER'] as const)(
    '%s is forbidden before any read (DT-175)',
    async (role) => {
      const { accounts, useCase } = build();
      await expect(useCase.execute(userOf(role))).rejects.toBeInstanceOf(ForbiddenError);
      expect(accounts.queries).toEqual([]);
    },
  );
});
