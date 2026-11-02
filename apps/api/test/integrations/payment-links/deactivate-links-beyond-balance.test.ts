import { describe, expect, it } from 'vitest';
import type { PaymentLink } from '../../../src/modules/integrations/domain/payment-link';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import { ConflictError, NotFoundError } from '../../../src/shared/domain';
import { REQ_1, REQ_2, REQ_3, buildWorld, invoiceOf, owner } from './world';

const make = (world: ReturnType<typeof buildWorld>, amount: string, requestId: string) =>
  world.create.execute(owner, { invoiceId: 'inv_1', amount, requestId });

describe('DeactivatePaymentLinksBeyondBalance', () => {
  it('is for the SYSTEM actor only', async () => {
    const world = buildWorld();
    await expect(
      world.sweep.execute({ actorType: 'USER', userId: owner.userId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does nothing while the links fit the balance', async () => {
    const world = buildWorld();
    await make(world, '40', REQ_1);
    await make(world, '60', REQ_2);
    const out = await world.sweep.execute(SYSTEM_ACTOR);
    expect(out).toEqual({ deactivated: [], skippedInvoiceIds: [], providerFailures: [] });
  });

  it('after an allocation shrinks the balance, deactivates the newest links only', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    world.clock.advance(60_000);
    await make(world, '30', REQ_2);
    world.clock.advance(60_000);
    await make(world, '40', REQ_3);
    // A payment of 45 was allocated: the balance is 55, the links add up to 100.
    world.invoices.add(invoiceOf({ openBalance: '55.00' }));

    const out = await world.sweep.execute(SYSTEM_ACTOR);

    expect(out.deactivated).toEqual(['lnk_3', 'lnk_2']);
    expect((await world.links.findById('lnk_1'))?.status).toBe('ACTIVE');
    expect((await world.links.findById('lnk_2'))?.status).toBe('DEACTIVATED');
    expect((await world.links.findById('lnk_3'))?.deactivationReason).toBe('BALANCE_SHRUNK');
    expect(world.provider.deactivated).toEqual(['plink_fake_3', 'plink_fake_2']);
    expect(world.activity.entries.filter((e) => e.action === 'UPDATE')).toHaveLength(2);
    expect(world.activity.entries.at(-1)?.actor).toEqual(SYSTEM_ACTOR);
  });

  it('counts the COMPLETED link as reserved and never touches it', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    const link = await world.links.findById('lnk_1');
    await world.links.save({ ...(link as PaymentLink), status: 'COMPLETED', paymentId: 'pay_1' });
    await make(world, '20', REQ_2);
    world.invoices.add(invoiceOf({ openBalance: '50.00' }));
    expect((await world.sweep.execute(SYSTEM_ACTOR)).deactivated).toEqual([]);
    world.invoices.add(invoiceOf({ openBalance: '40.00' }));
    expect((await world.sweep.execute(SYSTEM_ACTOR)).deactivated).toEqual(['lnk_2']);
    expect((await world.links.findById('lnk_1'))?.status).toBe('COMPLETED');
  });

  it('removes every open link of an invoice that is no longer open', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    await make(world, '30', REQ_2);
    world.invoices.add(invoiceOf({ open: false, openBalance: '0.00' }));
    const out = await world.sweep.execute(SYSTEM_ACTOR);
    expect([...out.deactivated].sort()).toEqual(['lnk_1', 'lnk_2']);
    expect((await world.links.findById('lnk_1'))?.deactivationReason).toBe('INVOICE_NOT_OPEN');
  });

  it('deactivates a PENDING link older than 24 hours without a provider call', async () => {
    const world = buildWorld();
    world.provider.failCreate = 1;
    await expect(make(world, '30', REQ_1)).rejects.toThrow();
    world.clock.advance(25 * 60 * 60 * 1000);
    const out = await world.sweep.execute(SYSTEM_ACTOR);
    expect(out.deactivated).toEqual(['lnk_1']);
    expect((await world.links.findById('lnk_1'))?.deactivationReason).toBe('PENDING_EXPIRED');
    expect(world.provider.deactivated).toEqual([]);
  });

  it('treats an invoice that no longer resolves as not open', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    world.invoices.load = async () => {
      throw new NotFoundError();
    };
    expect((await world.sweep.execute(SYSTEM_ACTOR)).deactivated).toEqual(['lnk_1']);
  });

  it('leaves the row DEACTIVATED on a provider failure and retries the call next run', async () => {
    const world = buildWorld();
    await make(world, '30', REQ_1);
    await make(world, '30', REQ_2);
    world.invoices.add(invoiceOf({ openBalance: '30.00' }));
    world.provider.failDeactivate = 1;

    const first = await world.sweep.execute(SYSTEM_ACTOR);
    expect(first.deactivated).toEqual(['lnk_2']);
    expect(first.providerFailures).toEqual(['lnk_2']);
    expect((await world.links.findById('lnk_2'))?.status).toBe('DEACTIVATED');
    expect(world.provider.deactivated).toEqual([]);

    // lnk_1 still holds the invoice in the worklist, so the failed call is repeated.
    world.clock.advance(60_000);
    const second = await world.sweep.execute(SYSTEM_ACTOR);
    expect(second.deactivated).toEqual([]);
    expect(second.providerFailures).toEqual([]);
    expect(world.provider.deactivated).toEqual(['plink_fake_2']);
  });

  it('skips an invoice that raises a ConflictError and carries on with the rest', async () => {
    const world = buildWorld({
      lockDecorator: (locks) => ({
        lock: async (set) => {
          if (set.Invoice?.includes('inv_1')) throw new ConflictError();
          return locks.lock(set);
        },
      }),
    });
    world.invoices.add(invoiceOf({ id: 'inv_2', number: 'F-002' }));
    // Seed through a world without the failing lock is not needed: create takes the lock too, so save directly.
    for (const [id, invoiceId] of [
      ['a', 'inv_1'],
      ['b', 'inv_2'],
    ] as const) {
      await world.links.save({
        id,
        invoiceId,
        requestId: id === 'a' ? REQ_1 : REQ_2,
        provider: 'STRIPE',
        externalId: `plink_${id}`,
        url: null,
        amount: '30.00',
        currency: 'USD',
        status: 'ACTIVE',
        paymentId: null,
        deactivationReason: null,
        createdAt: world.clock.now(),
        createdById: 'usr_owner',
        deactivatedAt: null,
        settledAt: null,
      });
    }
    world.invoices.add(invoiceOf({ id: 'inv_2', number: 'F-002', open: false }));
    const out = await world.sweep.execute(SYSTEM_ACTOR);
    expect(out.skippedInvoiceIds).toEqual(['inv_1']);
    expect(out.deactivated).toEqual(['b']);
  });
});
