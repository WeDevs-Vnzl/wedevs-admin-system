import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import { REQ_1, REQ_2, buildWorld, invoiceOf, owner } from './world';

const make = (world: ReturnType<typeof buildWorld>, amount: string, requestId: string) =>
  world.create.execute(owner, { invoiceId: 'inv_1', amount, requestId });

const DAY_MS = 24 * 60 * 60 * 1000;

describe('DeactivatePaymentLinksBeyondBalance: provider retry (DT-196)', () => {
  it('retries a failed provider call on an invoice with no other open link, then stops', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    world.invoices.add(invoiceOf({ open: false, openBalance: '0.00' }));
    world.provider.failDeactivate = 1;

    const first = await world.sweep.execute(SYSTEM_ACTOR);
    expect(first.deactivated).toEqual(['lnk_1']);
    expect(first.providerFailures).toEqual(['lnk_1']);

    // The invoice has no open link any more: only the owed call keeps the link in the worklist.
    world.clock.advance(DAY_MS);
    const second = await world.sweep.execute(SYSTEM_ACTOR);
    expect(second.providerFailures).toEqual([]);
    expect(world.provider.deactivated).toEqual(['plink_fake_1']);

    world.clock.advance(DAY_MS);
    await world.sweep.execute(SYSTEM_ACTOR);
    expect(world.provider.deactivated).toEqual(['plink_fake_1']);
  });

  it('keeps retrying beyond any time window until the call succeeds', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    world.invoices.add(invoiceOf({ open: false, openBalance: '0.00' }));
    world.provider.failDeactivate = 3;

    for (let day = 0; day < 3; day += 1) {
      const out = await world.sweep.execute(SYSTEM_ACTOR);
      expect(out.providerFailures).toEqual(['lnk_1']);
      world.clock.advance(30 * DAY_MS);
    }
    const last = await world.sweep.execute(SYSTEM_ACTOR);
    expect(last.providerFailures).toEqual([]);
    expect(world.provider.deactivated).toEqual(['plink_fake_1']);
  });

  it('retries a link deactivated by hand whose provider call failed', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    await make(world, '30', REQ_2);
    world.invoices.add(invoiceOf({ openBalance: '30.00' }));
    world.provider.failDeactivate = 1;
    expect((await world.sweep.execute(SYSTEM_ACTOR)).providerFailures).toEqual(['lnk_2']);
    world.clock.advance(100 * DAY_MS);
    expect((await world.sweep.execute(SYSTEM_ACTOR)).providerFailures).toEqual([]);
    expect(world.provider.deactivated).toEqual(['plink_fake_2']);
  });

  it('never calls the provider for a link that has no external id', async () => {
    const world = buildWorld();
    world.provider.failCreate = 1;
    await expect(make(world, '30', REQ_1)).rejects.toThrow();
    world.clock.advance(25 * 60 * 60 * 1000);
    await world.sweep.execute(SYSTEM_ACTOR);
    world.clock.advance(DAY_MS);
    await world.sweep.execute(SYSTEM_ACTOR);
    expect(world.provider.deactivated).toEqual([]);
  });
});
