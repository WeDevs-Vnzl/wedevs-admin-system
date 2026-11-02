import { describe, expect, it } from 'vitest';
import type { PaymentLink } from '../../../src/modules/integrations/domain/payment-link';
import { REQ_1, REQ_2, buildWorld, invoiceOf, member, owner, viewer } from './world';

const make = async (world: ReturnType<typeof buildWorld>, amount: string, requestId: string) =>
  world.create.execute(owner, { invoiceId: 'inv_1', amount, requestId });

describe('ListInvoicePaymentLinks', () => {
  it('lists every link newest first with the remaining capacity', async () => {
    const world = buildWorld();
    await make(world, '40', REQ_1);
    world.clock.advance(60_000);
    await make(world, '25.5', REQ_2);
    const out = await world.list.execute(owner, 'inv_1');
    expect(out.links.map((l) => l.id)).toEqual(['lnk_2', 'lnk_1']);
    expect(out.capacity).toBe('34.50');
    expect(out.links[0]).toMatchObject({ amount: '25.50', status: 'ACTIVE', currency: 'USD' });
  });

  it('shows zero capacity for an invoice that cannot carry links', async () => {
    const world = buildWorld();
    world.invoices.add(invoiceOf({ currency: 'VES' }));
    expect((await world.list.execute(owner, 'inv_1')).capacity).toBe('0.00');
    world.invoices.add(invoiceOf({ open: false }));
    expect((await world.list.execute(owner, 'inv_1')).capacity).toBe('0.00');
  });

  it('refuses a Member and answers NOT_FOUND for an unknown invoice', async () => {
    const world = buildWorld();
    await expect(world.list.execute(member, 'inv_1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(world.list.execute(viewer, 'inv_1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(world.list.execute(owner, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DeactivateInvoicePaymentLink', () => {
  it('deactivates in the database under the lock, then at the provider, with activity', async () => {
    const world = buildWorld();
    await make(world, '40', REQ_1);
    const out = await world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' });
    expect(out).toMatchObject({ status: 'DEACTIVATED', deactivationReason: 'MANUAL' });
    expect(world.provider.deactivated).toEqual(['plink_fake_1']);
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'UPDATE',
      entityType: 'PAYMENT_LINK',
      changes: { status: ['ACTIVE', 'DEACTIVATED'] },
    });
    // The freed amount is available again.
    expect((await world.list.execute(owner, 'inv_1')).capacity).toBe('100.00');
  });

  it('is idempotent: a second call writes no second activity entry', async () => {
    const world = buildWorld();
    await make(world, '40', REQ_1);
    await world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' });
    const entries = world.activity.entries.length;
    const again = await world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' });
    expect(again.status).toBe('DEACTIVATED');
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('keeps the row DEACTIVATED when the provider fails and retries the call on the next ask', async () => {
    const world = buildWorld();
    await make(world, '40', REQ_1);
    world.provider.failDeactivate = 1;
    await expect(
      world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' }),
    ).rejects.toThrow('provider down');
    expect((await world.links.findById('lnk_1'))?.status).toBe('DEACTIVATED');
    await world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' });
    expect(world.provider.deactivated).toEqual(['plink_fake_1']);
  });

  it('deactivates a PENDING link without a provider call', async () => {
    const world = buildWorld();
    world.provider.failCreate = 1;
    await expect(make(world, '40', REQ_1)).rejects.toThrow();
    const out = await world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' });
    expect(out.status).toBe('DEACTIVATED');
    expect(world.provider.deactivated).toEqual([]);
  });

  it('refuses a Member, a link of another invoice and a completed link', async () => {
    const world = buildWorld();
    await make(world, '40', REQ_1);
    await expect(
      world.deactivate.execute(member, { invoiceId: 'inv_1', linkId: 'lnk_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      world.deactivate.execute(owner, { invoiceId: 'inv_2', linkId: 'lnk_1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const link = await world.links.findById('lnk_1');
    await world.links.save({ ...(link as PaymentLink), status: 'COMPLETED', paymentId: 'pay_1' });
    await expect(
      world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
