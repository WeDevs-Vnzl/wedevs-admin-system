import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT,
  createWorld,
  rejection,
  type World,
} from '../../../../../../test/finance/billing/world';

let world: World;

/** A pending installment of the project, not billed and not referenced by any invoice. */
async function pendingInstallment(): Promise<string> {
  await world.upsertPlan.execute(world.owner, {
    projectId: PROJECT,
    model: 'PRECIO_FIJO',
    currency: 'USD',
    contractAmount: '10000',
  });
  const page = await world.createInstallment.execute(world.owner, {
    projectId: PROJECT,
    kind: 'ANTICIPO',
    label: 'Anticipo',
    amount: '4000',
    currency: 'USD',
  });
  return page.installments[0]?.id as string;
}

beforeEach(() => {
  world = createWorld();
});

describe('cancelling an installment (HU-09 CA3)', () => {
  it('an unknown installment is NOT_FOUND and nothing is logged', async () => {
    await pendingInstallment();
    const logged = world.activity.entries.length;

    expect(
      (await rejection(world.cancelInstallment.execute(world.owner, 'ins_missing'))).code,
    ).toBe('NOT_FOUND');
    expect(world.activity.entries).toHaveLength(logged);
  });

  it('an installment that disappears between the read and the lock is NOT_FOUND and stays pending', async () => {
    const id = await pendingInstallment();
    const real = world.repository.findInstallment.bind(world.repository);
    let reads = 0;
    world.repository.findInstallment = async (installmentId) => {
      reads += 1;
      return reads > 1 ? null : real(installmentId);
    };

    expect((await rejection(world.cancelInstallment.execute(world.owner, id))).code).toBe(
      'NOT_FOUND',
    );
    const row = world.repository.installments.find((item) => item.id === id);
    expect(row).toMatchObject({ status: 'PENDIENTE', cancelledAt: null });
  });
});
