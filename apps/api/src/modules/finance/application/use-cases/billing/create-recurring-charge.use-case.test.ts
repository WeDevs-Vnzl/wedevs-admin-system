import { beforeEach, describe, expect, it } from 'vitest';
import { PROJECT, createWorld, type World } from '../../../../../../test/finance/billing/world';
import { SYSTEM_ACTOR } from '../../recompute-all';

let world: World;

beforeEach(() => {
  world = createWorld();
  world.clock.set('2026-10-09T15:00:00.000Z');
});

describe('creating a recurring charge (PRD §8.4.3)', () => {
  it('without a lead time the charge leads by 7 days, so the period is generated on the 29th', async () => {
    await world.createCharge.execute(world.owner, {
      projectId: PROJECT,
      label: 'Soporte',
      amount: '100',
      currency: 'USD',
      frequency: 'MENSUAL',
      startDate: '2026-11-01',
      billingDay: 5,
    });
    const chargeId = world.repository.charges[0]?.id as string;
    expect(world.repository.charges[0]?.leadDays).toBe(7);

    world.clock.set('2026-10-28T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(
      world.repository.installments.filter((item) => item.recurringChargeId === chargeId),
    ).toHaveLength(0);

    world.clock.set('2026-10-29T15:00:00.000Z');
    await world.runGeneration.execute(SYSTEM_ACTOR);
    expect(
      world.repository.installments
        .filter((item) => item.recurringChargeId === chargeId)
        .map((item) => item.periodStart),
    ).toEqual(['2026-11-05']);
  });
});
