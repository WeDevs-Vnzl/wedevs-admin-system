import { beforeEach, describe, expect, it } from 'vitest';
import {
  CATEGORY,
  PROJECT,
  VES,
  ZELLE,
  createWorld,
  expenseRecord,
  query,
  rejection,
  type World,
} from '../../../../../../test/finance/expenses/world';
import { GENERATION_ACTOR } from './generate-recurring-expenses.use-case';
import type { CreateExpenseInput } from './create-expense.use-case';

let world: World;
beforeEach(() => {
  world = createWorld();
});

const input = (over: Partial<CreateExpenseInput> = {}): CreateExpenseInput => ({
  date: '2026-10-05',
  description: 'Gasto de prueba',
  categoryId: CATEGORY,
  currency: 'USD',
  amount: '10.00',
  usdRate: '1',
  status: 'PENDIENTE',
  ...over,
});

const seedPending = (over = {}) => world.expenses.seed(expenseRecord(over));

describe('createExpense (HU-17 CA2, §9.7)', () => {
  it('creates a pending expense with the next GAS code and a search entry', async () => {
    const created = await world.createExpense.execute(world.owner, input());

    expect(created).toMatchObject({
      code: 'GAS-0001',
      status: 'PENDIENTE',
      amount: '10.00',
      amountUsd: '10.00',
      paidAt: null,
      recurring: false,
      overdue: false,
    });
    expect(world.search.get('EXPENSE', created.id)?.code).toBe('GAS-0001');
    expect(world.activity.entries[0]).toMatchObject({ action: 'CREATE', entityType: 'EXPENSE' });
    expect(world.projector.calls).toEqual([`expense:${created.id}`]);
  });

  it('a paid expense debits its account: facts, balance and project margin are recomputed in order', async () => {
    const created = await world.createExpense.execute(
      world.owner,
      input({ status: 'PAGADO', accountId: ZELLE, projectId: PROJECT }),
    );

    expect(created).toMatchObject({ status: 'PAGADO', paidAt: '2026-10-05' });
    expect(world.projector.calls).toEqual([
      `expense:${created.id}`,
      `account:${ZELLE}`,
      `projects:${PROJECT}`,
    ]);
    expect(world.locks.acquired).toEqual([
      { rowClass: 'Project', id: PROJECT },
      { rowClass: 'Account', id: ZELLE },
    ]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('takes the USD snapshot from the rate given and keeps the paid date', async () => {
    const created = await world.createExpense.execute(
      world.owner,
      input({
        currency: 'VES',
        amount: '1000.00',
        usdRate: '755.16',
        status: 'PAGADO',
        accountId: VES,
        paidAt: '2026-10-07',
      }),
    );

    expect(created).toMatchObject({ amountUsd: '1.32', paidAt: '2026-10-07', accountAmount: null });
  });

  it('a paid expense requires the payment account', async () => {
    const error = await rejection(
      world.createExpense.execute(world.owner, input({ status: 'PAGADO' })),
    );

    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountId: ['expenses.validation.accountRequiredForPaid'] },
    });
  });

  it('a foreign-currency debit needs the amount debited in the account currency (§9.7)', async () => {
    const withoutDebit = input({
      currency: 'VES',
      amount: '7551.60',
      usdRate: '755.16',
      status: 'PAGADO',
      accountId: ZELLE,
    });
    const error = await rejection(world.createExpense.execute(world.owner, withoutDebit));
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountAmount: ['expenses.validation.accountAmountRequired'] },
    });

    const created = await world.createExpense.execute(world.owner, {
      ...withoutDebit,
      accountAmount: '10.00',
    });
    expect(created).toMatchObject({ amountUsd: '10.00', accountAmount: '10.00' });
  });

  it('an account in the expense currency stores no separate debit', async () => {
    const created = await world.createExpense.execute(
      world.owner,
      input({ status: 'PAGADO', accountId: ZELLE, accountAmount: '99.00' }),
    );

    expect(created.accountAmount).toBeNull();
  });

  it.each([
    ['categoryId', { categoryId: 'cat_missing' }, 'expenses.errors.categoryUnavailable'],
    ['accountId', { accountId: 'acc_missing' }, 'expenses.errors.accountUnavailable'],
    ['projectId', { projectId: 'pry_missing' }, 'expenses.errors.projectUnavailable'],
    ['receiptFileId', { receiptFileId: 'file_missing' }, 'expenses.errors.receiptUnavailable'],
  ])('never trusts a client id: unknown %s is a VALIDATION', async (field, over, key) => {
    const error = await rejection(world.createExpense.execute(world.owner, input(over)));

    expect(error).toMatchObject({ code: 'VALIDATION', fieldErrors: { [field]: [key] } });
    expect(world.expenses.all).toHaveLength(0);
  });

  it('claims the receipt file inside the unit of work', async () => {
    await world.createExpense.execute(world.owner, input({ receiptFileId: 'file_ok' }));

    expect(world.reservedFiles).toEqual(['file_ok']);
  });

  it.each([
    ['a zero amount', { amount: '0.00' }, 'amount'],
    ['a negative amount', { amount: '-5.00' }, 'amount'],
    ['three decimals', { amount: '1.005' }, 'amount'],
    ['a USD rate other than 1', { usdRate: '2' }, 'usdRate'],
    ['a zero rate', { currency: 'VES', usdRate: '0' }, 'usdRate'],
    ['a due date before the date', { dueDate: '2026-10-01' }, 'dueDate'],
    ['a blank description', { description: '   ' }, 'description'],
    ['an impossible date', { date: '2026-02-30' }, 'date'],
  ])('rejects %s without relying on the DTO', async (_name, over, field) => {
    const error = await rejection(world.createExpense.execute(world.owner, input(over)));

    expect(error.code).toBe('VALIDATION');
    expect(Object.keys(error.fieldErrors ?? {})).toContain(field);
  });

  it.each(['MEMBER', 'VIEWER'] as const)('%s gets FORBIDDEN (PRD §4.3)', async (role) => {
    const error = await rejection(
      world.createExpense.execute(world[role.toLowerCase() as 'member' | 'viewer'], input()),
    );

    expect(error.code).toBe('FORBIDDEN');
  });

  it('rolls back everything when a step fails', async () => {
    const error = await rejection(
      world.createExpense.execute(world.owner, input({ projectId: 'pry_missing' })),
    );

    expect(error.code).toBe('VALIDATION');
    expect(world.search.size).toBe(0);
    expect(world.activity.entries).toHaveLength(0);
  });
});

describe('markExpensePaid (HU-17 CA2)', () => {
  const pay = (over = {}) => ({
    id: 'exp_seed',
    accountId: ZELLE,
    paidAt: '2026-10-08',
    currency: 'USD',
    amount: '49.00',
    usdRate: '1',
    ...over,
  });

  it('confirms a pending expense: the real amount and rate retake the USD snapshot (§9.2)', async () => {
    seedPending({ currency: 'VES', amount: '1000.00', usdRate: '755.16', amountUsd: '1.32' });

    const paid = await world.markPaid.execute(
      world.owner,
      pay({ accountId: VES, currency: 'VES', amount: '1100.00', usdRate: '800.00' }),
    );

    expect(paid).toMatchObject({
      status: 'PAGADO',
      amount: '1100.00',
      amountUsd: '1.38',
      paidAt: '2026-10-08',
    });
    expect(paid.account?.id).toBe(VES);
    expect(world.projector.calls).toEqual(['expense:exp_seed', `account:${VES}`, 'projects:']);
    expect(world.activity.entries[0]).toMatchObject({
      action: 'STATUS_CHANGE',
      metadata: { from: 'PENDIENTE', to: 'PAGADO' },
    });
  });

  it('paying from another account recomputes only the paying account: a pending expense never fed the old one', async () => {
    seedPending({ accountId: VES });

    await world.markPaid.execute(world.owner, pay());

    expect(world.projector.calls).toEqual(['expense:exp_seed', `account:${ZELLE}`, 'projects:']);
    expect(world.locks.acquired.filter((row) => row.rowClass === 'Account')).toEqual([
      expect.objectContaining({ id: ZELLE }),
    ]);
  });

  it('refuses to mark again an expense that is already paid', async () => {
    seedPending({ status: 'PAGADO', accountId: ZELLE, paidAt: '2026-10-01' });

    const error = await rejection(world.markPaid.execute(world.owner, pay()));

    expect(error).toMatchObject({ code: 'CONFLICT', message: 'expenses.errors.notPending' });
  });

  it('a voided expense cannot be marked as paid', async () => {
    seedPending({ status: 'ANULADO' });

    const error = await rejection(world.markPaid.execute(world.owner, pay()));

    expect(error).toMatchObject({ code: 'CONFLICT', message: 'expenses.errors.voided' });
  });

  it('refuses an account that does not exist', async () => {
    seedPending();

    const error = await rejection(
      world.markPaid.execute(world.owner, pay({ accountId: 'acc_missing' })),
    );

    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountId: ['expenses.errors.accountUnavailable'] },
    });
  });

  it('a foreign-currency debit needs accountAmount', async () => {
    seedPending();

    const error = await rejection(
      world.markPaid.execute(
        world.owner,
        pay({ currency: 'VES', amount: '755.16', usdRate: '755.16' }),
      ),
    );

    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountAmount: expect.any(Array) },
    });
  });

  it('an unknown expense is NOT_FOUND', async () => {
    const error = await rejection(world.markPaid.execute(world.owner, pay({ id: 'exp_missing' })));

    expect(error.code).toBe('NOT_FOUND');
  });

  it('locks the project, the expense and the account up front, in the global order', async () => {
    seedPending({ projectId: PROJECT });

    await world.markPaid.execute(world.owner, pay());

    expect(world.locks.acquired).toEqual([
      { rowClass: 'Project', id: PROJECT },
      { rowClass: 'Expense', id: 'exp_seed' },
      { rowClass: 'Account', id: ZELLE },
    ]);
    expect(world.projector.calls).toEqual([
      'expense:exp_seed',
      `account:${ZELLE}`,
      `projects:${PROJECT}`,
    ]);
  });

  it('Member and Viewer get FORBIDDEN', async () => {
    seedPending();

    expect((await rejection(world.markPaid.execute(world.member, pay()))).code).toBe('FORBIDDEN');
    expect((await rejection(world.markPaid.execute(world.viewer, pay()))).code).toBe('FORBIDDEN');
  });
});

describe('voidExpense', () => {
  it('voiding a paid expense recomputes the account balance and the project margin', async () => {
    seedPending({ status: 'PAGADO', accountId: VES, projectId: PROJECT, paidAt: '2026-10-01' });

    const voided = await world.voidExpense.execute(world.owner, {
      id: 'exp_seed',
      reason: 'Duplicado',
    });

    expect(voided.status).toBe('ANULADO');
    expect(world.projector.calls).toEqual([
      'expense:exp_seed',
      `account:${VES}`,
      `projects:${PROJECT}`,
    ]);
    expect(world.activity.entries[0]).toMatchObject({
      metadata: { from: 'PAGADO', to: 'ANULADO', reason: 'Duplicado' },
    });
  });

  it('voiding twice is a CONFLICT', async () => {
    seedPending({ status: 'ANULADO' });

    const error = await rejection(world.voidExpense.execute(world.owner, { id: 'exp_seed' }));

    expect(error).toMatchObject({ code: 'CONFLICT', message: 'expenses.errors.voided' });
  });

  it('a voided period stays: its recurring schedule does not generate it again', async () => {
    seedPending({ recurringExpenseId: 'rex_seed', periodStart: '2026-10-05' });
    world.recurring.seed({
      id: 'rex_seed',
      name: 'Hosting',
      vendor: null,
      categoryId: CATEGORY,
      accountId: null,
      projectId: null,
      currency: 'USD',
      amount: '120.00',
      frequency: 'MENSUAL',
      dayOfPeriod: 5,
      leadDays: 5,
      startDate: '2026-10-01',
      endDate: null,
      status: 'ACTIVO',
      lastGeneratedPeriodStart: '2026-10-05',
      resumedOn: null,
      usdRate: '1',
      monthlyAmountUsd: '120.00',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    await world.voidExpense.execute(world.owner, { id: 'exp_seed' });

    const result = await world.generate.execute(GENERATION_ACTOR);

    expect(result).toEqual({ created: 0, periodStarts: [], skippedIds: [] });
  });
});

describe('updateExpense (Q-BE3-3)', () => {
  const update = (over = {}) => ({ ...input(), id: 'exp_seed', description: 'Editado', ...over });
  const withoutStatus = (value: Record<string, unknown>) => {
    const { status: _status, ...rest } = value;
    return rest as never;
  };

  it('edits a pending expense and records the field diff', async () => {
    seedPending({ projectId: PROJECT });

    const updated = await world.updateExpense.execute(
      world.owner,
      withoutStatus(update({ amount: '25.00', projectId: undefined })),
    );

    expect(updated).toMatchObject({
      description: 'Editado',
      amount: '25.00',
      amountUsd: '25.00',
      project: null,
    });
    expect(world.activity.entries[0]).toMatchObject({ action: 'UPDATE' });
    expect(world.projector.calls).toEqual(['expense:exp_seed']);
  });

  it.each([
    ['PAGADO', 'expenses.errors.notPending'],
    ['ANULADO', 'expenses.errors.voided'],
  ] as const)('a %s expense is a CONFLICT', async (status, message) => {
    seedPending({ status });

    const error = await rejection(
      world.updateExpense.execute(world.owner, withoutStatus(update())),
    );

    expect(error).toMatchObject({ code: 'CONFLICT', message });
  });

  it('locks the old and the new project', async () => {
    seedPending({ projectId: 'pry_old' });
    world.projects.add('pry_old');

    await world.updateExpense.execute(world.owner, withoutStatus(update({ projectId: PROJECT })));

    expect(
      world.locks.acquired.filter((row) => row.rowClass === 'Project').map((row) => row.id),
    ).toEqual(['pry_kairos', 'pry_old']);
  });

  it('Member gets FORBIDDEN', async () => {
    seedPending();

    expect(
      (await rejection(world.updateExpense.execute(world.member, withoutStatus(update())))).code,
    ).toBe('FORBIDDEN');
  });
});

describe('reading expenses', () => {
  beforeEach(() => {
    seedPending({
      id: 'e1',
      code: 'GAS-0001',
      description: 'Paid fee',
      vendor: 'Banco',
      status: 'PAGADO',
      accountId: VES,
      paidAt: '2026-10-01',
      date: '2026-10-01',
    });
    seedPending({
      id: 'e2',
      code: 'GAS-0002',
      description: 'Hosting',
      vendor: 'Vercel',
      dueDate: '2026-10-20',
      date: '2026-10-02',
      projectId: PROJECT,
    });
    seedPending({
      id: 'e3',
      code: 'GAS-0003',
      description: 'Overdue design',
      dueDate: '2026-10-05',
      date: '2026-09-20',
      amountUsd: '90.00',
    });
    seedPending({
      id: 'e4',
      code: 'GAS-0004',
      description: 'Voided',
      status: 'ANULADO',
      date: '2026-08-01',
    });
  });

  it('flags an overdue pending expense when read', async () => {
    expect((await world.getExpense.execute(world.owner, 'e3')).overdue).toBe(true);
    expect((await world.getExpense.execute(world.owner, 'e2')).overdue).toBe(false);
  });

  it('lists voided ones too, newest date first by default', async () => {
    const page = await world.listExpenses.execute(
      world.owner,
      query({ sort: { field: 'date', direction: 'desc' } }),
    );

    expect(page.items.map((row) => row.code)).toEqual([
      'GAS-0002',
      'GAS-0001',
      'GAS-0003',
      'GAS-0004',
    ]);
    expect(page.total).toBe(4);
  });

  it('filters by one or several statuses, project, date range and search', async () => {
    const sort = { field: 'code', direction: 'asc' } as const;
    const ask = (filters: Record<string, string | string[]>, extra = {}) =>
      world.listExpenses.execute(world.owner, query({ sort, filters, ...extra }));

    expect((await ask({ status: 'PAGADO' })).items.map((r) => r.code)).toEqual(['GAS-0001']);
    expect((await ask({ status: ['PAGADO', 'ANULADO'] })).items.map((r) => r.code)).toEqual([
      'GAS-0001',
      'GAS-0004',
    ]);
    expect((await ask({ projectId: [PROJECT] })).items.map((r) => r.code)).toEqual(['GAS-0002']);
    expect(
      (await ask({ dateFrom: '2026-10-01', dateTo: '2026-10-02' })).items.map((r) => r.code),
    ).toEqual(['GAS-0001', 'GAS-0002']);
    expect((await ask({}, { q: 'vercel' })).items.map((r) => r.code)).toEqual(['GAS-0002']);
    expect((await ask({}, { q: 'GAS-0004' })).items.map((r) => r.code)).toEqual(['GAS-0004']);
  });

  it('sorts by the USD amount', async () => {
    const page = await world.listExpenses.execute(
      world.owner,
      query({ sort: { field: 'amountUsd', direction: 'desc' } }),
    );

    expect(page.items[0]?.code).toBe('GAS-0003');
  });

  it('rejects a bad filter or sort without relying on the DTO', async () => {
    const badDate = await rejection(
      world.listExpenses.execute(world.owner, query({ filters: { dateFrom: 'nope' } })),
    );
    const badSort = await rejection(
      world.listExpenses.execute(world.owner, query({ sort: { field: 'nope', direction: 'asc' } })),
    );

    expect(badDate.fieldErrors).toHaveProperty('dateFrom');
    expect(badSort.fieldErrors).toHaveProperty('sort');
  });

  it('an unknown expense is NOT_FOUND', async () => {
    expect((await rejection(world.getExpense.execute(world.owner, 'nope'))).code).toBe('NOT_FOUND');
  });

  it('Member and Viewer cannot read', async () => {
    expect((await rejection(world.listExpenses.execute(world.member, query()))).code).toBe(
      'FORBIDDEN',
    );
    expect((await rejection(world.getExpense.execute(world.viewer, 'e1'))).code).toBe('FORBIDDEN');
  });
});
