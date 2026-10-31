import type { Actor } from '../../../../src/shared/application/actor';
import type { CurrentUser } from '../../../../src/shared/application/current-user';
import { addDays, CURRENCIES, dayOf, type Ctx, type Operation } from './ops-base';

const as = (actor: unknown) => actor as CurrentUser;

async function pickProject(ctx: Ctx) {
  return ctx.rng.pick(await ctx.world.db.project.findMany({ where: { deletedAt: null } }));
}

async function projectWithPlan(ctx: Ctx) {
  const plans = await ctx.world.db.billingPlan.findMany();
  return plans.length === 0 ? null : ctx.rng.pick(plans);
}

const upsertPlan: Operation = {
  name: 'upsertBillingPlan',
  async plan(ctx) {
    const project = await pickProject(ctx);
    const model = ctx.rng.pick(['PRECIO_FIJO', 'MIXTO', 'RECURRENTE'] as const);
    const input = {
      projectId: project.id,
      model,
      currency: ctx.rng.pick(CURRENCIES),
      contractAmount: model === 'RECURRENTE' ? null : ctx.rng.money(1000, 30000),
    };
    const uc = ctx.world.uc.upsertPlan;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, currency: 'ZZZ' }),
    };
  },
};

const applyTemplate: Operation = {
  name: 'applyInstallmentTemplate',
  async plan(ctx) {
    const plans = (await ctx.world.db.billingPlan.findMany()).filter(
      (candidate) => candidate.contractAmount !== null,
    );
    if (plans.length === 0) return null;
    const plan = ctx.rng.pick(plans);
    const input = {
      projectId: plan.projectId,
      template: ctx.rng.pick([
        'FULL_UPFRONT',
        'SPLIT_50_50',
        'SPLIT_40_30_30',
        'SPLIT_30_40_30',
        'THREE_EQUAL',
      ] as const),
      replacePending: ctx.rng.chance(0.7),
    };
    const uc = ctx.world.uc.applyTemplate;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () =>
        uc.execute(ctx.world.owner, { projectId: 'pry_missing', template: 'FULL_UPFRONT' }),
    };
  },
};

const createInstallment: Operation = {
  name: 'createInstallment',
  async plan(ctx) {
    const plan = await projectWithPlan(ctx);
    if (!plan) return null;
    const kind = ctx.rng.pick(['ANTICIPO', 'HITO', 'CUOTA', 'FINAL', 'AJUSTE'] as const);
    const input = {
      projectId: plan.projectId,
      kind,
      label: `Cuota ${ctx.nextNumber()}`,
      amount:
        kind === 'AJUSTE' && ctx.rng.chance(0.5)
          ? `-${ctx.rng.money(5, 300)}`
          : ctx.rng.money(50, 3000),
      currency: plan.currency,
      dueDate: addDays(ctx.today, ctx.rng.int(-15, 40)),
    };
    const uc = ctx.world.uc.createInstallment;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, amount: 'abc' }),
    };
  },
};

const liveInstallments = (ctx: Ctx) =>
  ctx.world.db.billingInstallment.findMany({ where: { status: { not: 'CANCELADA' } } });

const updateInstallment: Operation = {
  name: 'updateInstallment',
  async plan(ctx) {
    const rows = await liveInstallments(ctx);
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = {
      id: row.id,
      ...(ctx.rng.chance(0.6) ? { label: `Editada ${ctx.nextNumber()}` } : {}),
      ...(ctx.rng.chance(0.6) ? { amount: ctx.rng.money(50, 3000) } : {}),
      ...(ctx.rng.chance(0.5) ? { dueDate: addDays(ctx.today, ctx.rng.int(-15, 40)) } : {}),
    };
    const uc = ctx.world.uc.updateInstallment;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { id: row.id, amount: '-1' }),
    };
  },
};

const cancelInstallment: Operation = {
  name: 'cancelInstallment',
  async plan(ctx) {
    const rows = await liveInstallments(ctx);
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const uc = ctx.world.uc.cancelInstallment;
    return {
      describe: row.id,
      run: (actor) => uc.execute(as(actor), row.id),
      bad: () => uc.execute(ctx.world.owner, 'ins_missing'),
    };
  },
};

function schedule(ctx: Ctx, currency?: string) {
  const start = addDays(ctx.today, -ctx.rng.int(0, 120));
  return {
    label: `Mensualidad ${ctx.nextNumber()}`,
    amount: ctx.rng.money(40, 900),
    currency: currency ?? ctx.rng.pick(CURRENCIES),
    frequency: ctx.rng.pick(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as const),
    startDate: start,
    endDate: ctx.rng.chance(0.25) ? addDays(start, ctx.rng.int(60, 400)) : null,
    billingDay: ctx.rng.int(1, 28),
    leadDays: ctx.rng.int(0, 10),
  };
}

const createCharge: Operation = {
  name: 'createRecurringCharge',
  async plan(ctx) {
    const project = await pickProject(ctx);
    const input = { projectId: project.id, ...schedule(ctx) };
    const uc = ctx.world.uc.createCharge;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, billingDay: 31 }),
    };
  },
};

const updateCharge: Operation = {
  name: 'updateRecurringCharge',
  async plan(ctx) {
    const rows = await ctx.world.db.recurringCharge.findMany();
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = { id: row.id, ...schedule(ctx, ctx.rng.chance(0.5) ? row.currency : undefined) };
    const uc = ctx.world.uc.updateCharge;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, amount: '0' }),
    };
  },
};

const setChargeStatus: Operation = {
  name: 'setRecurringChargeStatus',
  async plan(ctx) {
    const rows = await ctx.world.db.recurringCharge.findMany();
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = {
      id: row.id,
      status: ctx.rng.pick(['ACTIVO', 'PAUSADO', 'ACTIVO', 'FINALIZADO'] as const),
    };
    const uc = ctx.world.uc.setChargeStatus;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { id: row.id, status: 'NOPE' as 'ACTIVO' }),
    };
  },
};

const generateMissingPeriods: Operation = {
  name: 'generateMissingPeriods',
  async plan(ctx) {
    const rows = await ctx.world.db.recurringCharge.findMany();
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = {
      recurringChargeId: row.id,
      ...(ctx.rng.chance(0.4) ? { upTo: addDays(ctx.today, ctx.rng.int(0, 90)) } : {}),
    };
    const uc = ctx.world.uc.generateMissingPeriods;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { recurringChargeId: 'rch_missing' }),
    };
  },
};

const generateRecurringInstallments: Operation = {
  name: 'generateRecurringInstallments',
  system: true,
  async plan(ctx) {
    const uc = ctx.world.uc.generateRecurringInstallments;
    return { describe: 'daily step', run: (actor) => uc.execute(actor as Actor) };
  },
};

/**
 * `SetProjectStatus` of `commercial` (rebound in package 6.3) cancels a project's billing through
 * `ProjectBillingApi` inside its own Serializable unit of work, after one lock call in the global order.
 */
const cancelForProject: Operation = {
  name: 'projectBilling.cancelForProject',
  // An internal API: the caller (`SetProjectStatus`) authorizes, so there is no refused path of its own.
  validOnly: true,
  async plan(ctx) {
    const project = await pickProject(ctx);
    const { world } = ctx;
    const clients = (
      await world.db.projectClient.findMany({ where: { projectId: project.id } })
    ).map((link) => link.clientId);
    const options = {
      cancelPendingInstallments: ctx.rng.chance(0.8),
      finishRecurringCharges: ctx.rng.chance(0.6),
    };
    const run = async () =>
      world.uow.run(
        async () => {
          await world.locks.lock({
            Project: [project.id],
            Client: clients,
            ...(await world.uc.projectBilling.lockSet(project.id)),
          });
          return world.uc.projectBilling.cancelForProject(project.id, options);
        },
        { isolation: 'Serializable' },
      );
    return {
      describe: `${project.id} ${JSON.stringify(options)}`,
      run,
    };
  },
};

export const BILLING: readonly Operation[] = [
  upsertPlan,
  applyTemplate,
  createInstallment,
  updateInstallment,
  cancelInstallment,
  createCharge,
  updateCharge,
  setChargeStatus,
  generateMissingPeriods,
  generateRecurringInstallments,
  cancelForProject,
];

export { dayOf };
