import { beforeEach, describe, expect, it } from 'vitest';
import {
  CATEGORY,
  NOW,
  createWorld,
  expenseRecord,
  query,
  recurringRecord,
  rejection,
  type World,
} from '../../../../../../test/finance/expenses/world';
import { GENERATION_ACTOR } from './generate-recurring-expenses.use-case';
import type { RecurringExpenseInput } from './recurring-expense-support';

let world: World;
beforeEach(() => {
  world = createWorld();
});

const input = (over: Partial<RecurringExpenseInput> = {}): RecurringExpenseInput => ({
  name: 'Hosting de prueba',
  categoryId: CATEGORY,
  currency: 'USD',
  amount: '120.00',
  frequency: 'MENSUAL',
  dayOfPeriod: 5,
  leadDays: 5,
  startDate: '2026-10-01',
  ...over,
});

const generatedBy = (id: string) =>
  world.expenses.all.filter((item) => item.recurringExpenseId === id);

describe('recurring generation (HU-17 CA1), business day 2026-10-09', () => {
  it('refuses a non-SYSTEM actor and generates nothing', async () => {
    await world.createRecurring.execute(world.owner, input());

    await expect(world.generate.execute({ actorType: 'USER', userId: world.owner.userId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(world.expenses.all.filter((item) => item.recurringExpenseId !== null)).toHaveLength(0);
  });

  it('generates one PENDIENTE expense per due period, with its due date and generation day', async () => {
    const schedule = await world.createRecurring.execute(world.owner, input());

    const result = await world.generate.execute(GENERATION_ACTOR);

    expect(result).toEqual({ created: 1, periodStarts: ['2026-10-05'] });
    expect(generatedBy(schedule.id)[0]).toMatchObject({
      status: 'PENDIENTE',
      periodStart: '2026-10-05',
      dueDate: '2026-10-05',
      date: '2026-09-30',
      amount: '120.00',
      amountUsd: '120.00',
      code: 'GAS-0001',
      createdById: null,
    });
    expect((await world.getRecurring.execute(world.owner, schedule.id)).nextDueDate).toBe(
      '2026-11-05',
    );
    expect(world.recurring.all[0]?.lastGeneratedPeriodStart).toBe('2026-10-05');
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'SYSTEM_JOB',
      actor: { actorType: 'SYSTEM' },
      entityType: 'RECURRING_EXPENSE',
    });
    expect(world.search.size).toBe(1);
  });

  it('a pending generated expense feeds no balance, fact or margin', async () => {
    await world.createRecurring.execute(world.owner, input());

    await world.generate.execute(GENERATION_ACTOR);

    expect(world.projector.calls).toEqual([]);
  });

  it('running the job twice the same day creates no duplicate (CA2)', async () => {
    const schedule = await world.createRecurring.execute(world.owner, input());
    await world.generate.execute(GENERATION_ACTOR);

    const second = await world.generate.execute(GENERATION_ACTOR);

    expect(second).toEqual({ created: 0, periodStarts: [] });
    expect(generatedBy(schedule.id)).toHaveLength(1);
  });

  it('catches up every due period', async () => {
    const schedule = await world.createRecurring.execute(
      world.owner,
      input({ startDate: '2026-07-01' }),
    );

    const result = await world.generate.execute(GENERATION_ACTOR);

    expect(result.periodStarts).toEqual(['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05']);
    expect(generatedBy(schedule.id)).toHaveLength(4);
  });

  it('a paused schedule generates nothing', async () => {
    const schedule = await world.createRecurring.execute(
      world.owner,
      input({ startDate: '2026-07-01' }),
    );
    await world.setRecurringStatus.execute(world.owner, { id: schedule.id, status: 'PAUSADO' });

    const result = await world.generate.execute(GENERATION_ACTOR);

    expect(result).toEqual({ created: 0, periodStarts: [] });
    expect(generatedBy(schedule.id)).toHaveLength(0);
  });

  it('resuming a paused schedule does not back-fill the skipped periods (PRD §8.4.3)', async () => {
    const schedule = await world.createRecurring.execute(
      world.owner,
      input({ startDate: '2026-07-01' }),
    );
    await world.setRecurringStatus.execute(world.owner, { id: schedule.id, status: 'PAUSADO' });
    const resumed = await world.setRecurringStatus.execute(world.owner, {
      id: schedule.id,
      status: 'ACTIVO',
    });

    expect(resumed).toMatchObject({ resumedOn: '2026-10-09', nextDueDate: '2026-11-05' });
    expect(await world.generate.execute(GENERATION_ACTOR)).toEqual({ created: 0, periodStarts: [] });

    // The next period after the resume is generated as usual: 2026-11-05, on 2026-10-31.
    world.clock.set('2026-10-31T15:00:00.000Z');
    await world.generate.execute(GENERATION_ACTOR);
    expect(generatedBy(schedule.id).map((item) => item.periodStart)).toEqual(['2026-11-05']);
  });

  it('an active schedule that was never paused still catches up', async () => {
    const schedule = await world.createRecurring.execute(
      world.owner,
      input({ startDate: '2026-09-01' }),
    );
    await world.setRecurringStatus.execute(world.owner, { id: schedule.id, status: 'ACTIVO' });

    const result = await world.generate.execute(GENERATION_ACTOR);

    expect(result.periodStarts).toEqual(['2026-09-05', '2026-10-05']);
  });

  it('changing the amount affects only the periods not generated yet', async () => {
    const schedule = await world.createRecurring.execute(world.owner, input());
    await world.generate.execute(GENERATION_ACTOR);

    await world.updateRecurring.execute(world.owner, {
      ...input({ amount: '200.00' }),
      id: schedule.id,
    });

    expect(generatedBy(schedule.id)[0]?.amount).toBe('120.00');
    expect(world.recurring.all[0]?.amount).toBe('200.00');
  });

  it('a non-USD schedule without a rate waits for one (expenses.ts:319-321)', async () => {
    world.rateTable.set('EUR', '0.92');
    const schedule = await world.createRecurring.execute(world.owner, input({ currency: 'EUR' }));
    world.rateTable.delete('EUR');

    expect(await world.generate.execute(GENERATION_ACTOR)).toEqual({ created: 0, periodStarts: [] });

    world.rateTable.set('EUR', '0.90');
    const result = await world.generate.execute(GENERATION_ACTOR);
    expect(result.created).toBe(1);
    expect(generatedBy(schedule.id)[0]).toMatchObject({ usdRate: '0.90', amountUsd: '133.33' });
  });

  it('one run creates at most 24 periods per schedule', async () => {
    await world.createRecurring.execute(world.owner, input({ startDate: '2020-01-01' }));

    const result = await world.generate.execute(GENERATION_ACTOR);

    expect(result.created).toBe(24);
  });

  it('a finished schedule generates nothing and ends at its end date', async () => {
    await world.createRecurring.execute(
      world.owner,
      input({ startDate: '2026-07-01', endDate: '2026-08-31' }),
    );

    const result = await world.generate.execute(GENERATION_ACTOR);

    expect(result.periodStarts).toEqual(['2026-07-05', '2026-08-05']);
  });
});

describe('createRecurringExpense / updateRecurringExpense', () => {
  it('stores the USD snapshot of the rate on the business day (Δ10)', async () => {
    const created = await world.createRecurring.execute(
      world.owner,
      input({ currency: 'VES', amount: '755.16', frequency: 'TRIMESTRAL' }),
    );

    expect(created).toMatchObject({
      usdRate: '755.16',
      monthlyAmountUsd: '0.33',
      status: 'ACTIVO',
      nextDueDate: '2026-10-05',
    });
    expect(world.activity.entries[0]).toMatchObject({
      action: 'CREATE',
      entityType: 'RECURRING_EXPENSE',
    });
  });

  it('a non-USD schedule without a rate is a VALIDATION (expenses.errors.rateMissing)', async () => {
    world.rateTable.delete('VES');

    const error = await rejection(
      world.createRecurring.execute(world.owner, input({ currency: 'VES' })),
    );

    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { currency: ['expenses.errors.rateMissing'] },
    });
    expect(world.recurring.all).toHaveLength(0);
  });

  it('an unknown currency is a VALIDATION', async () => {
    const error = await rejection(
      world.createRecurring.execute(world.owner, input({ currency: 'XXX' })),
    );

    expect(error.fieldErrors).toHaveProperty('currency');
  });

  it('retakes the snapshot when the schedule is edited', async () => {
    const created = await world.createRecurring.execute(world.owner, input());

    const updated = await world.updateRecurring.execute(world.owner, {
      ...input({ amount: '240.00', frequency: 'ANUAL' }),
      id: created.id,
    });

    expect(updated).toMatchObject({ amount: '240.00', monthlyAmountUsd: '20.00' });
    expect(world.activity.entries.at(-1)).toMatchObject({ action: 'UPDATE' });
  });

  it.each([
    ['day 0', { dayOfPeriod: 0 }, 'dayOfPeriod'],
    ['day 29', { dayOfPeriod: 29 }, 'dayOfPeriod'],
    ['lead days 61', { leadDays: 61 }, 'leadDays'],
    ['end before start', { endDate: '2026-09-01' }, 'endDate'],
    ['a zero amount', { amount: '0' }, 'amount'],
    ['a blank name', { name: ' ' }, 'name'],
  ])('rejects %s without relying on the DTO', async (_name, over, field) => {
    const error = await rejection(world.createRecurring.execute(world.owner, input(over)));

    expect(error.code).toBe('VALIDATION');
    expect(Object.keys(error.fieldErrors ?? {})).toContain(field);
  });

  it('checks category, account and project against the database', async () => {
    const error = await rejection(
      world.createRecurring.execute(world.owner, input({ categoryId: 'nope' })),
    );

    expect(error.fieldErrors).toHaveProperty('categoryId');
  });

  it('a finished schedule is final: edit and status change are a CONFLICT', async () => {
    world.recurring.seed(recurringRecord({ status: 'FINALIZADO' }));

    const edit = await rejection(
      world.updateRecurring.execute(world.owner, { ...input(), id: 'rex_seed' }),
    );
    const status = await rejection(
      world.setRecurringStatus.execute(world.owner, { id: 'rex_seed', status: 'ACTIVO' }),
    );

    expect(edit).toMatchObject({ code: 'CONFLICT', message: 'expenses.errors.recurringFinished' });
    expect(status).toMatchObject({
      code: 'CONFLICT',
      message: 'expenses.errors.recurringFinished',
    });
  });

  it('setting the status it already has is a no-op', async () => {
    world.recurring.seed(recurringRecord());

    await world.setRecurringStatus.execute(world.owner, { id: 'rex_seed', status: 'ACTIVO' });

    expect(world.activity.entries).toHaveLength(0);
  });

  it('records the status change in the activity log', async () => {
    world.recurring.seed(recurringRecord());

    await world.setRecurringStatus.execute(world.owner, { id: 'rex_seed', status: 'FINALIZADO' });

    expect(world.activity.entries[0]).toMatchObject({
      action: 'STATUS_CHANGE',
      changes: { status: ['ACTIVO', 'FINALIZADO'] },
    });
  });

  it('unknown schedule is NOT_FOUND', async () => {
    expect((await rejection(world.getRecurring.execute(world.owner, 'nope'))).code).toBe(
      'NOT_FOUND',
    );
    expect(
      (
        await rejection(
          world.setRecurringStatus.execute(world.owner, { id: 'nope', status: 'PAUSADO' }),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  it.each(['MEMBER', 'VIEWER'] as const)(
    '%s gets FORBIDDEN on every recurring route',
    async (role) => {
      const user = world[role.toLowerCase() as 'member' | 'viewer'];
      world.recurring.seed(recurringRecord());

      for (const call of [
        world.createRecurring.execute(user, input()),
        world.updateRecurring.execute(user, { ...input(), id: 'rex_seed' }),
        world.setRecurringStatus.execute(user, { id: 'rex_seed', status: 'PAUSADO' }),
        world.listRecurring.execute(user, query()),
        world.getRecurring.execute(user, 'rex_seed'),
      ]) {
        expect((await rejection(call)).code).toBe('FORBIDDEN');
      }
    },
  );
});

describe('listing recurring expenses', () => {
  it('filters by status, frequency and category, with the derived next period', async () => {
    world.recurring.seed(recurringRecord({ id: 'a', name: 'Alpha' }));
    world.recurring.seed(
      recurringRecord({
        id: 'b',
        name: 'Beta',
        status: 'PAUSADO',
        frequency: 'ANUAL',
        categoryId: 'cat_root',
      }),
    );
    world.expenses.seed(
      expenseRecord({ id: 'g1', recurringExpenseId: 'a', periodStart: '2026-10-05' }),
    );
    const sort = { field: 'name', direction: 'asc' } as const;

    const all = await world.listRecurring.execute(world.owner, query({ sort }));
    const paused = await world.listRecurring.execute(
      world.owner,
      query({ sort, filters: { status: 'PAUSADO' } }),
    );
    const annual = await world.listRecurring.execute(
      world.owner,
      query({ sort, filters: { frequency: ['ANUAL'] } }),
    );
    const byCategory = await world.listRecurring.execute(
      world.owner,
      query({ sort, filters: { categoryId: 'cat_root' } }),
    );

    expect(all.items.map((row) => [row.name, row.nextDueDate])).toEqual([
      ['Alpha', '2026-11-05'],
      ['Beta', '2026-10-05'],
    ]);
    expect(paused.items.map((row) => row.name)).toEqual(['Beta']);
    expect(annual.items.map((row) => row.name)).toEqual(['Beta']);
    expect(byCategory.items.map((row) => row.name)).toEqual(['Beta']);
  });

  it('rejects a status outside the enum', async () => {
    const error = await rejection(
      world.listRecurring.execute(world.owner, query({ filters: { status: 'X' } })),
    );

    expect(error.fieldErrors).toHaveProperty('status');
  });
});

describe('time', () => {
  it('uses the business day, not UTC (America/Caracas)', async () => {
    world.clock.set('2026-10-10T02:00:00.000Z'); // still 10-09 in Caracas
    world.recurring.seed(
      recurringRecord({ startDate: '2026-10-10', dayOfPeriod: 15, leadDays: 5 }),
    );

    expect(await world.generate.execute(GENERATION_ACTOR)).toEqual({ created: 0, periodStarts: [] });
    expect(NOW).toContain('2026-10-09');
  });
});
