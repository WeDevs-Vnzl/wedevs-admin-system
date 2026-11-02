import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT,
  createWorld,
  rejection,
  type World,
} from '../../../../../../test/finance/billing/world';

let world: World;

const schedule = (over: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  label: 'Soporte',
  amount: '100',
  currency: 'USD',
  frequency: 'MENSUAL' as const,
  startDate: '2026-11-01',
  billingDay: 5,
  leadDays: 7,
  ...over,
});

/** A monthly USD charge of the project; returns its id. */
async function chargeId(): Promise<string> {
  await world.createCharge.execute(world.owner, schedule());
  return world.repository.charges[0]?.id as string;
}

beforeEach(() => {
  world = createWorld();
});

describe('editing a recurring charge (HU-10)', () => {
  it('a charge that disappears between the read and the lock is NOT_FOUND and keeps its values', async () => {
    const id = await chargeId();
    const real = world.repository.findCharge.bind(world.repository);
    let reads = 0;
    world.repository.findCharge = async (chargeKey) => {
      reads += 1;
      return reads > 1 ? null : real(chargeKey);
    };

    expect(
      (
        await rejection(
          world.updateCharge.execute(world.owner, { id, ...schedule({ label: 'Nuevo' }) }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(world.repository.charges[0]?.label).toBe('Soporte');
  });

  it('a change of currency to one without a rate of the day is refused and writes nothing', async () => {
    const id = await chargeId();
    const error = await rejection(
      world.updateCharge.execute(world.owner, { id, ...schedule({ currency: 'EUR' }) }),
    );

    expect(error.fieldErrors?.currency).toEqual(['billing.errors.rateMissing']);
    expect(world.repository.charges[0]).toMatchObject({ currency: 'USD', usdRate: '1' });
  });
});
