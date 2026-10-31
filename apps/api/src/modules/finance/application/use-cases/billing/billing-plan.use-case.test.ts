import { describe, expect, it } from 'vitest';
import {
  CLIENT,
  PROJECT,
  createWorld,
  rateRow,
  rejection,
  type World,
} from '../../../../../../test/finance/billing/world';
import type { UpsertBillingPlanInput } from './upsert-billing-plan.use-case';

const planInput = (over: Partial<UpsertBillingPlanInput> = {}): UpsertBillingPlanInput => ({
  projectId: PROJECT,
  model: 'PRECIO_FIJO',
  currency: 'USD',
  contractAmount: '10000',
  ...over,
});

const eurRate = (world: World, usdRate = '0.90') =>
  world.rateRepository.seed(rateRow('2026-10-09', 'EUR', usdRate));

const amountsOf = (page: {
  installments: readonly { amount: string; cancelledAt: string | null }[];
}) => page.installments.filter((item) => item.cancelledAt === null).map((item) => item.amount);

describe('billing plan and D1 snapshot (HU-09)', () => {
  it('a USD contract snapshots its amount in USD at rate 1', async () => {
    const world = createWorld();
    const page = await world.upsertPlan.execute(world.owner, planInput());
    expect(page.plan).toMatchObject({
      contractAmount: '10000.00',
      contractedUsd: '10000.00',
      usdRate: '1',
    });
  });

  it('a non-USD contract snapshots the rate of the day and never recomputes it (D1, C16)', async () => {
    const world = createWorld();
    eurRate(world);
    const saved = await world.upsertPlan.execute(
      world.owner,
      planInput({ currency: 'EUR', contractAmount: '1000' }),
    );
    expect(saved.plan).toMatchObject({ contractedUsd: '1111.11', usdRate: '0.90' });

    // The rate moves afterwards: a save that keeps the contract keeps the snapshot.
    eurRate(world, '0.50');
    const resaved = await world.upsertPlan.execute(
      world.owner,
      planInput({ currency: 'EUR', contractAmount: '1000.00' }),
    );
    expect(resaved.plan).toMatchObject({ contractedUsd: '1111.11', usdRate: '0.90' });

    await world.createInstallment.execute(world.owner, {
      projectId: PROJECT,
      kind: 'CUOTA',
      label: 'Cuota de prueba',
      amount: '100',
      currency: 'EUR',
    });
    expect((await world.getPage.execute(world.owner, PROJECT)).plan?.contractedUsd).toBe('1111.11');

    // Changing the contract takes a new snapshot at the rate of the day.
    const changed = await world.upsertPlan.execute(
      world.owner,
      planInput({ currency: 'EUR', contractAmount: '2000' }),
    );
    expect(changed.plan).toMatchObject({ usdRate: '0.50', contractedUsd: '4000.00' });
  });

  it('a non-USD contract without a rate of the day is refused with the rate message', async () => {
    const world = createWorld();
    const error = await rejection(
      world.upsertPlan.execute(world.owner, planInput({ currency: 'EUR', contractAmount: '1000' })),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors?.currency).toEqual(['billing.errors.rateMissing']);
  });

  it('a plan without a contract keeps the rate of the day when there is one', async () => {
    const world = createWorld();
    eurRate(world);
    const page = await world.upsertPlan.execute(
      world.owner,
      planInput({ model: 'RECURRENTE', currency: 'EUR', contractAmount: undefined }),
    );
    expect(page.plan).toMatchObject({ contractAmount: null, contractedUsd: null, usdRate: '0.90' });
  });

  it('an archived or unknown project is NOT_FOUND', async () => {
    const world = createWorld();
    world.projects.live.delete(PROJECT);
    expect((await rejection(world.upsertPlan.execute(world.owner, planInput()))).code).toBe(
      'NOT_FOUND',
    );
    expect(
      (
        await rejection(
          world.upsertPlan.execute(world.owner, planInput({ projectId: 'pry_missing' })),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  it('a project that gets other clients between the read and the lock is a CONFLICT', async () => {
    const world = createWorld();
    const real = world.projects.liveProject.bind(world.projects);
    let reads = 0;
    world.projects.liveProject = async (id) => {
      const project = await real(id);
      reads += 1;
      return project && reads > 1 ? { ...project, clientIds: [CLIENT, 'cli_new'] } : project;
    };
    expect((await rejection(world.upsertPlan.execute(world.owner, planInput()))).code).toBe(
      'CONFLICT',
    );
  });

  it('saving again updates the same plan and logs UPDATE; the first save logs CREATE', async () => {
    const world = createWorld();
    const first = await world.upsertPlan.execute(world.owner, planInput());
    const second = await world.upsertPlan.execute(world.owner, planInput({ notes: 'nota' }));
    expect(second.plan?.id).toBe(first.plan?.id);
    expect(world.activity.entries.map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE']);
    expect(world.activity.entries[0]).toMatchObject({
      entityType: 'BILLING_PLAN',
      entityLabel: 'PRY-0001',
      clientId: CLIENT,
      touchClientIds: [CLIENT],
    });
  });

  it('a billed installment blocks a currency change (C19); a voided invoice releases it', async () => {
    const world = createWorld();
    eurRate(world);
    await world.upsertPlan.execute(world.owner, planInput());
    const page = await world.createInstallment.execute(world.owner, {
      projectId: PROJECT,
      kind: 'ANTICIPO',
      label: 'A',
      amount: '4000',
      currency: 'USD',
    });
    const installmentId = page.installments[0]?.id as string;
    world.repository.bill(installmentId, '4000.00');

    const blocked = await rejection(
      world.upsertPlan.execute(world.owner, planInput({ currency: 'EUR', contractAmount: '1000' })),
    );
    expect(blocked).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'billing.errors.currencyLocked',
    });
    expect(world.locks.acquired.map((lock) => lock.rowClass)).toContain('BillingInstallment');

    world.repository.release(installmentId);
    const ok = await world.upsertPlan.execute(
      world.owner,
      planInput({ currency: 'EUR', contractAmount: '1000' }),
    );
    expect(ok.plan?.currency).toBe('EUR');
  });

  it.each([
    ['an unknown model', { model: 'X' as never }, 'model'],
    ['a zero contract', { contractAmount: '0' }, 'contractAmount'],
    ['a contract with three decimals', { contractAmount: '10.001' }, 'contractAmount'],
    ['a fixed price without contract', { contractAmount: undefined }, 'contractAmount'],
    ['a bad currency code', { currency: 'usd' }, 'currency'],
    ['notes over 2000 characters', { notes: 'x'.repeat(2001) }, 'notes'],
  ])('refuses %s without a DTO', async (_name, over, field) => {
    const world = createWorld();
    const error = await rejection(world.upsertPlan.execute(world.owner, planInput(over)));
    expect(error.code).toBe('VALIDATION');
    expect(Object.keys(error.fieldErrors ?? {})).toContain(field);
  });

  it('a currency the catalog does not know is a field error', async () => {
    const world = createWorld();
    const error = await rejection(
      world.upsertPlan.execute(world.owner, planInput({ currency: 'ZZZ' })),
    );
    expect(error.fieldErrors?.currency).toEqual(['validation.currency.invalid']);
  });

  it('Member and Viewer are FORBIDDEN, Admin may', async () => {
    const world = createWorld();
    for (const user of [world.member, world.viewer]) {
      expect((await rejection(world.upsertPlan.execute(user, planInput()))).code).toBe('FORBIDDEN');
      expect((await rejection(world.getPage.execute(user, PROJECT))).code).toBe('FORBIDDEN');
    }
    await expect(world.upsertPlan.execute(world.admin, planInput())).resolves.toBeDefined();
  });

  it('runs one Serializable unit of work that locks project, clients and plan before anything else', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    await world.upsertPlan.execute(world.owner, planInput({ notes: 'otra' }));
    expect(world.locks.acquired.map((lock) => lock.rowClass)).toEqual([
      'Project',
      'Client',
      'BillingPlan',
    ]);
    // Projections: the project's clients, then the project, in this order (Wave 3 must know).
    expect(world.projector.calls.slice(-2)).toEqual([
      { method: 'projectClients', ids: [CLIENT] },
      { method: 'projectProjects', ids: [PROJECT] },
    ]);
  });

  it('a failed mutation writes nothing and projects nothing', async () => {
    const world = createWorld();
    await rejection(world.upsertPlan.execute(world.owner, planInput({ currency: 'EUR' })));
    expect(world.repository.installments).toHaveLength(0);
    expect(await world.repository.findPlan(PROJECT)).toBeNull();
    expect(world.activity.entries).toHaveLength(0);
    expect(world.projector.calls).toHaveLength(0);
  });
});

describe('quick template (HU-09 CA1)', () => {
  it('40/30/30 on 10 000 USD generates 4 000, 3 000 and 3 000', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    const page = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'SPLIT_40_30_30',
      replacePending: true,
    });
    expect(amountsOf(page)).toEqual(['4000.00', '3000.00', '3000.00']);
    expect(page.installments.map((item) => item.percentage)).toEqual(['40', '30', '30']);
    expect(page.installments.every((item) => item.currency === 'USD')).toBe(true);
    expect(page.plan?.scheduleConsistent).toBe(true);
  });

  it('replacing the pending installments cancels the previous ones', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    await world.applyTemplate.execute(world.owner, { projectId: PROJECT, template: 'SPLIT_50_50' });
    const page = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'THREE_EQUAL',
      replacePending: true,
    });
    // 33.33 / 33.33 / 33.34 applied to 10 000: the last part absorbs the remainder.
    expect(amountsOf(page)).toEqual(['3333.00', '3333.00', '3334.00']);
    expect(page.installments.filter((item) => item.cancelledAt !== null)).toHaveLength(2);
    expect(
      world.locks.acquired.filter((lock) => lock.rowClass === 'BillingInstallment'),
    ).toHaveLength(2);
  });

  it('keeps the billed and the recurring installments when replacing, and appends without replacePending', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    const first = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'SPLIT_50_50',
    });
    world.repository.bill(first.installments[0]?.id as string, '5000.00');
    const replaced = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'FULL_UPFRONT',
    });
    expect(replaced.installments.filter((item) => item.cancelledAt === null)).toHaveLength(2);
    expect(
      replaced.installments.find((item) => item.id === first.installments[0]?.id)?.cancelledAt,
    ).toBeNull();

    const appended = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'FULL_UPFRONT',
      replacePending: false,
    });
    expect(appended.installments.filter((item) => item.cancelledAt === null)).toHaveLength(3);
  });

  it('a template needs a contract amount', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(
      world.owner,
      planInput({ model: 'RECURRENTE', contractAmount: undefined }),
    );
    const error = await rejection(
      world.applyTemplate.execute(world.owner, { projectId: PROJECT, template: 'SPLIT_50_50' }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors?.template).toEqual(['billing.validation.contractAmountRequired']);
  });

  it('a template needs a plan', async () => {
    const world = createWorld();
    const error = await rejection(
      world.applyTemplate.execute(world.owner, { projectId: PROJECT, template: 'SPLIT_50_50' }),
    );
    expect(error.fieldErrors?.projectId).toEqual(['billing.errors.planRequired']);
  });

  it('CUSTOM needs drafts and a fixed template refuses them', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    const draft = { kind: 'HITO' as const, label: 'H', amount: '100', currency: 'USD' };
    expect(
      (
        await rejection(
          world.applyTemplate.execute(world.owner, { projectId: PROJECT, template: 'CUSTOM' }),
        )
      ).fieldErrors?.installments,
    ).toEqual(['billing.validation.customInstallmentsRequired']);
    expect(
      (
        await rejection(
          world.applyTemplate.execute(world.owner, {
            projectId: PROJECT,
            template: 'SPLIT_50_50',
            installments: [draft],
          }),
        )
      ).fieldErrors?.installments,
    ).toEqual(['billing.validation.templateInstallmentsNotAllowed']);
    const page = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'CUSTOM',
      installments: [draft, { ...draft, kind: 'AJUSTE', amount: '-50' }],
    });
    expect(amountsOf(page)).toEqual(['100.00', '-50.00']);
  });

  it('refuses a RECURRENTE draft, a zero AJUSTE, a negative CUOTA and an unknown currency', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    const run = (draft: object) =>
      rejection(
        world.applyTemplate.execute(world.owner, {
          projectId: PROJECT,
          template: 'CUSTOM',
          installments: [{ kind: 'CUOTA', label: 'x', amount: '10', currency: 'USD', ...draft }],
        }),
      );
    expect((await run({ kind: 'RECURRENTE' })).fieldErrors?.['installments.0.kind']).toEqual([
      'billing.validation.installmentKindNotManual',
    ]);
    expect(
      (await run({ kind: 'AJUSTE', amount: '0' })).fieldErrors?.['installments.0.amount'],
    ).toEqual(['billing.validation.adjustmentNonZero']);
    expect((await run({ amount: '-5' })).fieldErrors?.['installments.0.amount']).toEqual([
      'validation.money.mustBePositive',
    ]);
    expect((await run({ currency: 'ZZZ' })).fieldErrors?.['installments.0.currency']).toEqual([
      'validation.currency.invalid',
    ]);
  });

  it('logs the cancelled and the created installments', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'FULL_UPFRONT',
    });
    await world.applyTemplate.execute(world.owner, { projectId: PROJECT, template: 'SPLIT_50_50' });
    expect(world.activity.entries.map((entry) => `${entry.action}:${entry.entityType}`)).toEqual([
      'CREATE:BILLING_PLAN',
      'CREATE:INSTALLMENT',
      'STATUS_CHANGE:INSTALLMENT',
      'CREATE:INSTALLMENT',
      'CREATE:INSTALLMENT',
    ]);
  });
});

describe('installment sum check (HU-09 CA2)', () => {
  const create = (
    world: World,
    kind: 'ANTICIPO' | 'HITO' | 'FINAL' | 'AJUSTE',
    label: string,
    amount: string,
  ) =>
    world.createInstallment.execute(world.owner, {
      projectId: PROJECT,
      kind,
      label,
      amount,
      currency: 'USD',
    });

  it('installments that differ from the contract by more than 0.01 leave the warning on', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    await create(world, 'ANTICIPO', 'A', '4000');
    const page = await create(world, 'HITO', 'B', '3000');
    expect(page.plan?.scheduleConsistent).toBe(false);
    expect(page.plan?.scheduleDifference).toBe('-3000.00');
  });

  it('a difference of exactly 0.01 is accepted, and AJUSTE installments are not counted', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    await create(world, 'ANTICIPO', 'A', '4000');
    await create(world, 'FINAL', 'B', '5999.99');
    expect((await world.getPage.execute(world.owner, PROJECT)).plan?.scheduleConsistent).toBe(true);

    const page = await create(world, 'AJUSTE', 'Ajuste de alcance', '-500');
    expect(page.plan?.scheduleConsistent).toBe(true);
    expect(page.plan?.installmentsTotal).toBe('9999.99');
  });

  it('a plan without a contract is always consistent', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(
      world.owner,
      planInput({ model: 'RECURRENTE', contractAmount: undefined }),
    );
    const page = await create(world, 'HITO', 'A', '10');
    expect(page.plan).toMatchObject({ scheduleDifference: null, scheduleConsistent: true });
  });
});

describe('the billing page', () => {
  it('lists the installments by order, cancelled ones included, and the plan sees only its own', async () => {
    const world = createWorld();
    await world.upsertPlan.execute(world.owner, planInput());
    await world.createInstallment.execute(world.owner, {
      projectId: PROJECT,
      kind: 'HITO',
      label: 'Segundo',
      amount: '10',
      currency: 'USD',
      order: 5,
    });
    const page = await world.createInstallment.execute(world.owner, {
      projectId: PROJECT,
      kind: 'HITO',
      label: 'Primero',
      amount: '10',
      currency: 'USD',
      order: 1,
    });
    expect(page.installments.map((item) => item.label)).toEqual(['Primero', 'Segundo']);
    expect(page.plan?.installments).toHaveLength(2);
  });

  it('a project without a plan has an empty page; an unknown or archived one is NOT_FOUND', async () => {
    const world = createWorld();
    expect(await world.getPage.execute(world.owner, PROJECT)).toEqual({
      projectId: PROJECT,
      plan: null,
      installments: [],
      recurringCharges: [],
    });
    expect((await rejection(world.getPage.execute(world.owner, 'pry_missing'))).code).toBe(
      'NOT_FOUND',
    );
  });

  it('reads on one repeatable-read snapshot', async () => {
    const world = createWorld();
    await world.getPage.execute(world.owner, PROJECT);
    expect(world.uow.lastOptions).toEqual({ isolation: 'RepeatableRead' });
  });
});
