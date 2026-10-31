import type { CurrentUser } from '../../../../src/shared/application/current-user';
import { addDays, CURRENCIES, rateFor, type Ctx, type Operation } from './ops-base';

const as = (actor: unknown) => actor as CurrentUser;

async function optionalProject(ctx: Ctx): Promise<string | null> {
  if (ctx.rng.chance(0.3)) return null;
  const projects = await ctx.world.db.project.findMany({ where: { deletedAt: null } });
  return ctx.rng.pick(projects).id;
}

async function pickAccount(ctx: Ctx) {
  const accounts = await ctx.world.db.account.findMany({ where: { active: true } });
  return accounts.length === 0 ? null : ctx.rng.pick(accounts);
}

/** Currency fields of an expense paid from `account`: its own currency, or USD debited as another currency. */
function money(ctx: Ctx, account: { currency: string } | null) {
  const crossCurrency = account !== null && account.currency !== 'USD' && ctx.rng.chance(0.25);
  const currency = crossCurrency ? 'USD' : (account?.currency ?? ctx.rng.pick(CURRENCIES));
  return {
    currency,
    amount: ctx.rng.money(5, 700),
    usdRate: rateFor(ctx, currency),
    accountAmount: crossCurrency ? ctx.rng.money(100, 30000) : null,
  };
}

const createExpense: Operation = {
  name: 'createExpense',
  async plan(ctx) {
    const paid = ctx.rng.chance(0.5);
    const account = await pickAccount(ctx);
    if (paid && !account) return null;
    const date = addDays(ctx.today, -ctx.rng.int(0, 25));
    const input = {
      date,
      dueDate: addDays(date, ctx.rng.int(0, 30)),
      description: `Gasto ${ctx.nextNumber()}`,
      categoryId: ctx.refs.categoryId,
      accountId: paid ? (account?.id ?? null) : null,
      projectId: await optionalProject(ctx),
      ...money(ctx, paid ? account : null),
      status: paid ? ('PAGADO' as const) : ('PENDIENTE' as const),
      paidAt: paid ? date : null,
    };
    if (!paid) input.accountAmount = null;
    const uc = ctx.world.uc.createExpense;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, amount: '-3.00' }),
    };
  },
};

const updateExpense: Operation = {
  name: 'updateExpense',
  async plan(ctx) {
    const rows = await ctx.world.db.expense.findMany({ where: { status: 'PENDIENTE' } });
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const date = addDays(ctx.today, -ctx.rng.int(0, 25));
    const input = {
      id: row.id,
      date,
      dueDate: addDays(date, ctx.rng.int(0, 30)),
      description: `Gasto editado ${ctx.nextNumber()}`,
      categoryId: ctx.refs.categoryId,
      accountId: null,
      projectId: await optionalProject(ctx),
      ...money(ctx, null),
      accountAmount: null,
    };
    const uc = ctx.world.uc.updateExpense;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, amount: 'abc' }),
    };
  },
};

const markExpensePaid: Operation = {
  name: 'markExpensePaid',
  async plan(ctx) {
    const rows = await ctx.world.db.expense.findMany({ where: { status: 'PENDIENTE' } });
    const account = await pickAccount(ctx);
    if (rows.length === 0 || !account) return null;
    const row = ctx.rng.pick(rows);
    const input = {
      id: row.id,
      accountId: account.id,
      paidAt: addDays(ctx.today, -ctx.rng.int(0, 10)),
      ...money(ctx, account),
    };
    const uc = ctx.world.uc.markExpensePaid;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, accountId: 'acc_missing' }),
    };
  },
};

const voidExpense: Operation = {
  name: 'voidExpense',
  async plan(ctx) {
    const rows = await ctx.world.db.expense.findMany({ where: { status: { not: 'ANULADO' } } });
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = { id: row.id, reason: ctx.rng.chance(0.5) ? 'Duplicado' : null };
    const uc = ctx.world.uc.voidExpense;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { id: 'exp_missing' }),
    };
  },
};

function recurringInput(ctx: Ctx, account: { id: string; currency: string } | null) {
  const start = addDays(ctx.today, -ctx.rng.int(0, 150));
  return {
    name: `Suscripcion ${ctx.nextNumber()}`,
    categoryId: ctx.refs.categoryId,
    accountId: account?.id ?? null,
    currency: account?.currency ?? ctx.rng.pick(CURRENCIES),
    amount: ctx.rng.money(10, 500),
    frequency: ctx.rng.pick(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as const),
    dayOfPeriod: ctx.rng.int(1, 28),
    leadDays: ctx.rng.int(0, 10),
    startDate: start,
    endDate: ctx.rng.chance(0.25) ? addDays(start, ctx.rng.int(60, 500)) : null,
  };
}

const createRecurringExpense: Operation = {
  name: 'createRecurringExpense',
  async plan(ctx) {
    const input = {
      ...recurringInput(ctx, ctx.rng.chance(0.6) ? await pickAccount(ctx) : null),
      projectId: await optionalProject(ctx),
    };
    const uc = ctx.world.uc.createRecurringExpense;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, dayOfPeriod: 31 }),
    };
  },
};

const updateRecurringExpense: Operation = {
  name: 'updateRecurringExpense',
  async plan(ctx) {
    const rows = await ctx.world.db.recurringExpense.findMany();
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = {
      id: row.id,
      ...recurringInput(ctx, null),
      projectId: await optionalProject(ctx),
    };
    const uc = ctx.world.uc.updateRecurringExpense;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, amount: '0' }),
    };
  },
};

const setRecurringExpenseStatus: Operation = {
  name: 'setRecurringExpenseStatus',
  async plan(ctx) {
    const rows = await ctx.world.db.recurringExpense.findMany();
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = {
      id: row.id,
      status: ctx.rng.pick(['ACTIVO', 'PAUSADO', 'ACTIVO', 'FINALIZADO'] as const),
    };
    const uc = ctx.world.uc.setRecurringExpenseStatus;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { id: row.id, status: 'NOPE' as 'ACTIVO' }),
    };
  },
};

const generateRecurringExpenses: Operation = {
  name: 'generateRecurringExpenses',
  // A job step: it takes no user input and checks no actor, so it has no refused path to drive.
  validOnly: true,
  async plan(ctx) {
    const uc = ctx.world.uc.generateRecurringExpenses;
    return { describe: 'daily step', run: () => uc.execute() };
  },
};

export const EXPENSES: readonly Operation[] = [
  createExpense,
  updateExpense,
  markExpensePaid,
  voidExpense,
  createRecurringExpense,
  updateRecurringExpense,
  setRecurringExpenseStatus,
  generateRecurringExpenses,
];
