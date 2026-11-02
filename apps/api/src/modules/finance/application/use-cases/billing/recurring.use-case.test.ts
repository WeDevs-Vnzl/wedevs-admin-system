import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT,
  createWorld,
  rateRow,
  rejection,
  type World,
} from '../../../../../../test/finance/billing/world';
import { SYSTEM_ACTOR } from '../../recompute-all';
import type { CreateRecurringChargeInput } from './create-recurring-charge.use-case';

let world: World;

const chargeInput = (
  over: Partial<CreateRecurringChargeInput> = {},
): CreateRecurringChargeInput & { leadDays: number } => ({
  projectId: PROJECT,
  label: 'Soporte',
  amount: '100',
  currency: 'USD',
  frequency: 'MENSUAL',
  startDate: '2026-11-01',
  billingDay: 5,
  leadDays: 7,
  ...over,
});

/** Monthly charge billed on the 5th with 7 days of lead: the first period is 2026-11-05, generated on 2026-10-29. */
async function monthlyCharge(over: Partial<CreateRecurringChargeInput> = {}) {
  await world.upsertPlan.execute(world.owner, {
    projectId: PROJECT,
    model: 'PRECIO_FIJO',
    currency: 'USD',
    contractAmount: '10000',
  });
  const page = await world.createCharge.execute(world.owner, chargeInput(over));
  const chargeId = page.recurringCharges.find((item) => item.label === (over.label ?? 'Soporte'))
    ?.id as string;
  const generated = () =>
    world.repository.installments.filter((item) => item.recurringChargeId === chargeId);
  return { chargeId, generated };
}

const at = (iso: string) => world.clock.set(iso);

beforeEach(() => {
  world = createWorld();
});

describe('recurring charges (HU-10)', () => {
  it('the period is generated on the 29th of the previous month, with the 5th as its date', async () => {
    const { generated } = await monthlyCharge();
    at('2026-10-28T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(generated()).toHaveLength(0);

    at('2026-10-29T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(generated()).toHaveLength(1);
    expect(generated()[0]).toMatchObject({
      kind: 'RECURRENTE',
      periodStart: '2026-11-05',
      periodEnd: '2026-12-04',
      dueDate: '2026-11-05',
      amount: '100.00',
      status: 'PENDIENTE',
      label: 'Soporte · 2026-11-05',
    });
  });

  it('running the step twice on the same day creates no duplicate', async () => {
    const { chargeId, generated } = await monthlyCharge();
    at('2026-10-29T15:00:00.000Z');
    const first = await world.runGeneration.execute(SYSTEM_ACTOR);
    const second = await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(first).toEqual({ created: 1, periodStarts: ['2026-11-05'], skippedIds: [] });
    expect(second).toEqual({ created: 0, periodStarts: [], skippedIds: [] });
    expect(generated()).toHaveLength(1);
    expect((await world.repository.findCharge(chargeId))?.lastGeneratedPeriodStart).toBe(
      '2026-11-05',
    );
    expect(world.activity.entries.filter((entry) => entry.action === 'SYSTEM_JOB')).toHaveLength(1);
  });

  it('a paused charge generates nothing; on request it creates the missing periods', async () => {
    const { chargeId, generated } = await monthlyCharge();
    await world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'PAUSADO' });
    at('2026-12-31T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(generated()).toHaveLength(0);

    const result = await world.generateMissing.execute(world.owner, {
      recurringChargeId: chargeId,
      upTo: '2026-12-31',
    });
    expect(result.periodStarts).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    expect(generated()).toHaveLength(3);
  });

  it('resuming a paused charge does not back-fill the skipped periods (PRD §8.4.3)', async () => {
    const { chargeId, generated } = await monthlyCharge();
    await world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'PAUSADO' });
    at('2027-01-09T15:00:00.000Z');
    await world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'ACTIVO' });
    expect((await world.repository.findCharge(chargeId))?.resumedOn).toBe('2027-01-09');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(generated()).toHaveLength(0);

    // The next period after the resume is generated as usual: 2027-02-05, on 2027-01-29.
    at('2027-01-29T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(generated().map((item) => item.periodStart)).toEqual(['2027-02-05']);

    // The skipped ones stay available on request.
    at('2027-01-09T15:00:00.000Z');
    const missing = await world.generateMissing.execute(world.owner, {
      recurringChargeId: chargeId,
      upTo: '2027-01-09',
    });
    expect(missing.periodStarts).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
  });

  it('on request without upTo reaches the lead days after today', async () => {
    const { chargeId } = await monthlyCharge();
    at('2026-10-29T15:00:00.000Z');
    const result = await world.generateMissing.execute(world.owner, {
      recurringChargeId: chargeId,
    });
    expect(result.periodStarts).toEqual(['2026-11-05']);
    expect((await world.repository.listInstallments(PROJECT)).at(-1)?.order).toBe(0);
  });

  it('a finished charge is final and generates nothing', async () => {
    const { chargeId } = await monthlyCharge();
    await world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'FINALIZADO' });
    expect(
      await rejection(
        world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'ACTIVO' }),
      ),
    ).toMatchObject({ code: 'CONFLICT', message: 'billing.errors.chargeFinished' });
    expect(
      (await rejection(world.generateMissing.execute(world.owner, { recurringChargeId: chargeId })))
        .code,
    ).toBe('CONFLICT');
    expect(
      (await rejection(world.updateCharge.execute(world.owner, { id: chargeId, ...chargeInput() })))
        .code,
    ).toBe('CONFLICT');
    at('2026-12-31T15:00:00.000Z');
    expect((await world.runGeneration.execute(SYSTEM_ACTOR)).created).toBe(0);
  });

  it('asking for the current status changes nothing: no write, no projection, no entry', async () => {
    const { chargeId } = await monthlyCharge();
    const entries = world.activity.entries.length;
    const calls = world.projector.calls.length;
    await world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'ACTIVO' });
    expect(world.activity.entries).toHaveLength(entries);
    expect(world.projector.calls).toHaveLength(calls);
  });

  it('the monthly equivalent of a quarterly charge is a third of it (C17)', async () => {
    await world.upsertPlan.execute(world.owner, {
      projectId: PROJECT,
      model: 'PRECIO_FIJO',
      currency: 'USD',
      contractAmount: '10000',
    });
    const page = await world.createCharge.execute(
      world.owner,
      chargeInput({ label: 'Trimestral', amount: '300', frequency: 'TRIMESTRAL' }),
    );
    expect(page.recurringCharges[0]?.monthlyAmount).toBe('100.00');
    expect(
      (await world.repository.findCharge(page.recurringCharges[0]?.id as string))?.monthlyAmountUsd,
    ).toBe('100.00');
  });

  it('a charge ends at its endDate: no period after it', async () => {
    const { generated } = await monthlyCharge({ endDate: '2026-12-31' });
    at('2027-06-01T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(generated().map((item) => item.periodStart)).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('a charge whose project was archived is skipped by the step', async () => {
    const { generated } = await monthlyCharge();
    world.projects.live.delete(PROJECT);
    at('2026-10-29T15:00:00.000Z');
    expect(await world.runGeneration.execute(SYSTEM_ACTOR)).toEqual({
      created: 0,
      periodStarts: [],
      skippedIds: [],
    });
    expect(generated()).toHaveLength(0);
  });

  it('only the system runs the step', async () => {
    expect(
      (await rejection(world.runGeneration.execute({ actorType: 'USER', userId: 'usr_owner' })))
        .code,
    ).toBe('FORBIDDEN');
  });

  it('locks project, clients and the charge, and projects clients then project', async () => {
    const { chargeId } = await monthlyCharge();
    await world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'PAUSADO' });
    expect(world.locks.acquired).toEqual([
      { rowClass: 'Project', id: PROJECT },
      { rowClass: 'Client', id: 'cli_a' },
      { rowClass: 'RecurringCharge', id: chargeId },
    ]);
    expect(world.projector.calls.slice(-2).map((call) => call.method)).toEqual([
      'projectClients',
      'projectProjects',
    ]);
  });
});

describe('the USD snapshot of a charge (Δ10, C16)', () => {
  it('a non-USD charge takes the rate of the business day and its monthly USD', async () => {
    world.rateRepository.seed(rateRow('2026-10-09', 'EUR', '0.90'));
    const page = await world.createCharge.execute(
      world.owner,
      chargeInput({ currency: 'EUR', amount: '300', frequency: 'TRIMESTRAL' }),
    );
    const stored = await world.repository.findCharge(page.recurringCharges[0]?.id as string);
    expect(stored).toMatchObject({ usdRate: '0.90', monthlyAmountUsd: '111.11' });
  });

  it('a non-USD charge without a rate is refused', async () => {
    const error = await rejection(
      world.createCharge.execute(world.owner, chargeInput({ currency: 'EUR' })),
    );
    expect(error.fieldErrors?.currency).toEqual(['billing.errors.rateMissing']);
    expect(world.repository.charges).toHaveLength(0);
  });

  it('an edit retakes the rate when the amount or currency changes, keeps it when only the label does', async () => {
    world.rateRepository.seed(rateRow('2026-10-09', 'EUR', '0.90'));
    const created = await world.createCharge.execute(world.owner, chargeInput({ currency: 'EUR' }));
    const id = created.recurringCharges[0]?.id as string;
    world.rateRepository.seed(rateRow('2026-10-09', 'EUR', '0.50'));

    await world.updateCharge.execute(world.owner, {
      id,
      ...chargeInput({ currency: 'EUR', label: 'Otro' }),
    });
    expect(await world.repository.findCharge(id)).toMatchObject({
      usdRate: '0.90',
      monthlyAmountUsd: '111.11',
    });

    await world.updateCharge.execute(world.owner, {
      id,
      ...chargeInput({ currency: 'EUR', amount: '200', frequency: 'TRIMESTRAL' }),
    });
    expect(await world.repository.findCharge(id)).toMatchObject({
      usdRate: '0.50',
      monthlyAmountUsd: '133.34',
    });

    world.rateRepository.seed(rateRow('2026-10-09', 'EUR', '0.25'));
    await world.updateCharge.execute(world.owner, {
      id,
      ...chargeInput({ currency: 'EUR', amount: '200', frequency: 'MENSUAL' }),
    });
    expect(await world.repository.findCharge(id)).toMatchObject({
      usdRate: '0.50',
      monthlyAmountUsd: '400.00',
    });
  });

  it('editing changes only future periods: the generated installments keep their amount', async () => {
    const { chargeId, generated } = await monthlyCharge();
    at('2026-10-29T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    await world.updateCharge.execute(world.owner, {
      id: chargeId,
      ...chargeInput({ amount: '250' }),
    });
    expect(generated()[0]?.amount).toBe('100.00');
    expect((await world.repository.findCharge(chargeId))?.amount).toBe('250.00');
  });
});

describe('recurring charge rules enforced without a DTO', () => {
  it.each([
    ['billingDay 0', { billingDay: 0 }, 'billingDay', 'billing.validation.billingDayRange'],
    ['billingDay 29', { billingDay: 29 }, 'billingDay', 'billing.validation.billingDayRange'],
    ['leadDays 61', { leadDays: 61 }, 'leadDays', 'billing.validation.leadDaysRange'],
    ['leadDays -1', { leadDays: -1 }, 'leadDays', 'billing.validation.leadDaysRange'],
    ['a zero amount', { amount: '0' }, 'amount', 'validation.money.mustBePositive'],
    ['a negative amount', { amount: '-5' }, 'amount', 'validation.money.mustBePositive'],
    [
      'an end before the start',
      { endDate: '2026-10-31' },
      'endDate',
      'billing.validation.endBeforeStart',
    ],
    ['a bad start date', { startDate: '2026-13-01' }, 'startDate', 'validation.date.invalid'],
    ['an unknown frequency', { frequency: 'DIARIA' as never }, 'frequency', 'validation.required'],
    ['an empty label', { label: '  ' }, 'label', 'validation.required'],
    ['a bad currency', { currency: 'usd' }, 'currency', 'validation.currency.invalid'],
  ])('refuses %s', async (_name, over, field, key) => {
    const error = await rejection(world.createCharge.execute(world.owner, chargeInput(over)));
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors?.[field]).toContain(key);
  });

  it('refuses a bad upTo and an unknown status', async () => {
    const { chargeId } = await monthlyCharge();
    expect(
      (
        await rejection(
          world.generateMissing.execute(world.owner, { recurringChargeId: chargeId, upTo: 'nope' }),
        )
      ).fieldErrors?.upTo,
    ).toEqual(['validation.date.invalid']);
    expect(
      (
        await rejection(
          world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'X' as never }),
        )
      ).fieldErrors?.status,
    ).toBeDefined();
  });

  it('unknown charges and archived projects are NOT_FOUND', async () => {
    const { chargeId } = await monthlyCharge();
    for (const id of ['rch_missing']) {
      expect(
        (await rejection(world.setChargeStatus.execute(world.owner, { id, status: 'PAUSADO' })))
          .code,
      ).toBe('NOT_FOUND');
      expect(
        (await rejection(world.updateCharge.execute(world.owner, { id, ...chargeInput() }))).code,
      ).toBe('NOT_FOUND');
      expect(
        (await rejection(world.generateMissing.execute(world.owner, { recurringChargeId: id })))
          .code,
      ).toBe('NOT_FOUND');
    }
    world.projects.live.delete(PROJECT);
    expect(
      (
        await rejection(
          world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'PAUSADO' }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect((await rejection(world.createCharge.execute(world.owner, chargeInput()))).code).toBe(
      'NOT_FOUND',
    );
  });

  it('Member and Viewer are FORBIDDEN', async () => {
    const { chargeId } = await monthlyCharge();
    for (const user of [world.member, world.viewer]) {
      expect((await rejection(world.createCharge.execute(user, chargeInput()))).code).toBe(
        'FORBIDDEN',
      );
      expect(
        (await rejection(world.updateCharge.execute(user, { id: chargeId, ...chargeInput() })))
          .code,
      ).toBe('FORBIDDEN');
      expect(
        (await rejection(world.setChargeStatus.execute(user, { id: chargeId, status: 'PAUSADO' })))
          .code,
      ).toBe('FORBIDDEN');
      expect(
        (await rejection(world.generateMissing.execute(user, { recurringChargeId: chargeId })))
          .code,
      ).toBe('FORBIDDEN');
    }
  });
});

describe('ProjectBillingApi (exported to commercial, HU-08 CA3)', () => {
  it('answers the activity questions of the project', async () => {
    expect(await world.projectApi.hasBillingPlan(PROJECT)).toBe(false);
    expect(await world.projectApi.hasActiveBilling(PROJECT)).toBe(false);
    expect(await world.projectApi.hasActiveRecurringCharge(PROJECT)).toBe(false);

    const { chargeId } = await monthlyCharge();
    expect(await world.projectApi.hasBillingPlan(PROJECT)).toBe(true);
    expect(await world.projectApi.hasActiveRecurringCharge(PROJECT)).toBe(true);
    expect(await world.projectApi.hasActiveBilling(PROJECT)).toBe(true);

    await world.setChargeStatus.execute(world.owner, { id: chargeId, status: 'FINALIZADO' });
    expect(await world.projectApi.hasActiveRecurringCharge(PROJECT)).toBe(false);
    expect(await world.projectApi.hasActiveBilling(PROJECT)).toBe(false);
    world.repository.issuedProjects.add(PROJECT);
    expect(await world.projectApi.hasActiveBilling(PROJECT)).toBe(true);
  });

  it('names the rows the caller must lock', async () => {
    const { chargeId } = await monthlyCharge();
    const page = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'FULL_UPFRONT',
    });
    expect(await world.projectApi.lockSet(PROJECT)).toEqual({
      RecurringCharge: [chargeId],
      BillingInstallment: [page.installments[0]?.id],
    });
  });

  it('cancels the pending unbilled installments and finishes the live charges, as chosen', async () => {
    const { chargeId } = await monthlyCharge({ endDate: '2027-12-31' });
    const page = await world.applyTemplate.execute(world.owner, {
      projectId: PROJECT,
      template: 'SPLIT_50_50',
    });
    world.repository.bill(page.installments[0]?.id as string, '5000.00');
    world.projector.calls.length = 0;

    const result = await world.uow.run(() =>
      world.projectApi.cancelForProject(PROJECT, {
        cancelPendingInstallments: true,
        finishRecurringCharges: true,
      }),
    );
    expect(result).toEqual({ installments: 1, recurringCharges: 1 });
    const stored = await world.repository.findCharge(chargeId);
    expect(stored).toMatchObject({ status: 'FINALIZADO', endDate: '2026-10-09' });
    expect(
      world.repository.installments.filter((item) => item.status === 'CANCELADA'),
    ).toHaveLength(1);
    expect(world.projector.calls.map((call) => call.method)).toEqual([
      'projectClients',
      'projectProjects',
    ]);
  });

  it('respects each option, keeps an earlier end date and projects nothing when nothing changed', async () => {
    const { chargeId } = await monthlyCharge({ endDate: '2026-12-01' });
    world.projector.calls.length = 0;
    expect(
      await world.projectApi.cancelForProject(PROJECT, {
        cancelPendingInstallments: true,
        finishRecurringCharges: false,
      }),
    ).toEqual({ installments: 0, recurringCharges: 0 });
    expect(world.projector.calls).toHaveLength(0);

    await world.projectApi.cancelForProject(PROJECT, {
      cancelPendingInstallments: false,
      finishRecurringCharges: true,
    });
    expect(await world.repository.findCharge(chargeId)).toMatchObject({
      status: 'FINALIZADO',
      endDate: '2026-10-09',
    });
    expect(
      await world.projectApi.cancelForProject(PROJECT, {
        cancelPendingInstallments: false,
        finishRecurringCharges: true,
      }),
    ).toEqual({ installments: 0, recurringCharges: 0 });
  });
});
