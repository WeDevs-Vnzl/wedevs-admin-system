import { describe, expect, it } from 'vitest';
import type { PaymentLink } from '../../../src/modules/integrations/domain/payment-link';
import { REQ_1, REQ_2, REQ_3, buildWorld, invoiceOf, member, owner, viewer } from './world';

const create = (world: ReturnType<typeof buildWorld>, amount: string, requestId: string) =>
  world.create.execute(owner, { invoiceId: 'inv_1', amount, requestId });

const seeded = (over: Partial<PaymentLink>): PaymentLink => ({
  id: 'seed',
  invoiceId: 'inv_1',
  requestId: '99999999-9999-4999-8999-999999999999',
  provider: 'STRIPE',
  externalId: 'plink_seed',
  url: 'https://pay.example.test/seed',
  amount: '10.00',
  currency: 'USD',
  status: 'ACTIVE',
  paymentId: null,
  deactivationReason: null,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  createdById: 'usr_owner',
  deactivatedAt: null,
  settledAt: null,
  ...over,
});

describe('CreateInvoicePaymentLink', () => {
  it('refuses when the Owner has not mapped Stripe to an account, and the capacity reads zero', async () => {
    const world = buildWorld();
    world.mapping.set({ stripe: null });
    await expect(create(world, '40', REQ_1)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'validation.paymentLinkCurrencyUnsupported',
    });
    expect(await world.links.listByInvoice('inv_1')).toEqual([]);
    expect(world.provider.createKeys).toEqual([]);
    expect((await world.list.execute(owner, 'inv_1')).capacity).toBe('0.00');
  });

  it('refuses when the mapped account is not in the invoice currency, and the capacity reads zero', async () => {
    const world = buildWorld();
    world.accounts.currencies.set('acc_stripe', 'EUR');
    await expect(create(world, '40', REQ_1)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'validation.paymentLinkCurrencyUnsupported',
    });
    expect(await world.links.listByInvoice('inv_1')).toEqual([]);
    expect((await world.list.execute(owner, 'inv_1')).capacity).toBe('0.00');
  });

  it('refuses when the mapped account is gone or inactive', async () => {
    const world = buildWorld();
    world.accounts.currencies.delete('acc_stripe');
    await expect(create(world, '40', REQ_1)).rejects.toMatchObject({
      message: 'validation.paymentLinkCurrencyUnsupported',
    });
    expect((await world.list.execute(owner, 'inv_1')).capacity).toBe('0.00');
  });

  it('creates a EUR link when the mapped account is in EUR', async () => {
    const world = buildWorld();
    world.accounts.currencies.set('acc_stripe', 'EUR');
    world.invoices.add(invoiceOf({ currency: 'EUR' }));
    expect(await create(world, '40', REQ_1)).toMatchObject({ currency: 'EUR', status: 'ACTIVE' });
    expect((await world.list.execute(owner, 'inv_1')).capacity).toBe('60.00');
  });

  it('creates an ACTIVE link: lock first, Serializable, provider key, activity', async () => {
    const world = buildWorld();
    const isolations: (string | undefined)[] = [];
    const run = world.uow.run.bind(world.uow);
    world.uow.run = (work, options) => {
      isolations.push(options?.isolation);
      return run(work, options);
    };
    const out = await create(world, '40', REQ_1);

    expect(out).toMatchObject({
      id: 'lnk_1',
      status: 'ACTIVE',
      amount: '40.00',
      currency: 'USD',
      externalId: 'plink_fake_1',
      url: 'https://pay.example.test/plink_fake_1',
    });
    // The provider call sits between the two units of work, never inside one.
    expect(isolations).toEqual(['Serializable', undefined]);
    expect(world.rowLocks.acquired).toEqual([{ rowClass: 'Invoice', id: 'inv_1' }]);
    const sent = world.provider.links.get('plink_fake_1')?.request;
    expect(sent).toMatchObject({
      idempotencyKey: 'invoice-link:lnk_1',
      amount: '40.00',
      currency: 'USD',
      metadata: { invoiceId: 'inv_1', linkId: 'lnk_1' },
    });
    expect(world.activity.entries).toEqual([
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'PAYMENT_LINK',
        entityId: 'lnk_1',
        actor: { actorType: 'USER', userId: 'usr_owner' },
        metadata: expect.objectContaining({
          invoiceId: 'inv_1',
          amount: '40.00',
          currency: 'USD',
        }),
      }),
    ]);
    expect(world.activity.entries[0]?.clientId).toBeUndefined();
  });

  it('refuses a Member and a Viewer before touching anything', async () => {
    const world = buildWorld();
    for (const user of [member, viewer]) {
      await expect(
        world.create.execute(user, { invoiceId: 'inv_1', amount: '10', requestId: REQ_1 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(world.provider.links.size).toBe(0);
    expect(await world.links.listByInvoice('inv_1')).toEqual([]);
  });

  it('refuses an invoice that is not open with INTEGRITY_LOCK', async () => {
    const world = buildWorld();
    world.invoices.add(invoiceOf({ open: false }));
    await expect(create(world, '10', REQ_1)).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
  });

  it('refuses an unknown invoice with NOT_FOUND', async () => {
    const world = buildWorld();
    await expect(
      world.create.execute(owner, { invoiceId: 'nope', amount: '10', requestId: REQ_1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a VES invoice with paymentLinkCurrencyUnsupported (DT-197)', async () => {
    const world = buildWorld();
    world.invoices.add(invoiceOf({ currency: 'VES' }));
    await expect(create(world, '10', REQ_1)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'validation.paymentLinkCurrencyUnsupported',
    });
    expect(world.provider.links.size).toBe(0);
  });

  it('accepts EUR', async () => {
    const world = buildWorld();
    world.accounts.currencies.set('acc_stripe', 'EUR');
    world.invoices.add(invoiceOf({ currency: 'EUR' }));
    expect((await create(world, '10', REQ_1)).currency).toBe('EUR');
  });

  it('refuses an amount below the minimum and a malformed one', async () => {
    const world = buildWorld();
    await expect(create(world, '0.49', REQ_1)).rejects.toMatchObject({
      fieldErrors: { amount: ['validation.paymentLinkBelowMinimum'] },
    });
    await expect(create(world, '1.005', REQ_1)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(create(world, 'abc', REQ_1)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await create(world, '0.50', REQ_1)).amount).toBe('0.50');
  });

  it('refuses a requestId that is not a UUID', async () => {
    const world = buildWorld();
    await expect(create(world, '10', 'not-a-uuid')).rejects.toMatchObject({
      fieldErrors: { requestId: ['validation.uuid.invalid'] },
    });
  });

  it('allows 40 then 60 on a balance of 100 and refuses 0.01 more', async () => {
    const world = buildWorld();
    await create(world, '40', REQ_1);
    await create(world, '60', REQ_2);
    await expect(create(world, '0.01', REQ_3)).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { amount: ['validation.paymentLinkExceedsCapacity'] },
    });
    expect(await world.links.listByInvoice('inv_1')).toHaveLength(2);
  });

  it('refuses an amount above the capacity', async () => {
    const world = buildWorld();
    await expect(create(world, '100.01', REQ_1)).rejects.toMatchObject({
      fieldErrors: { amount: ['validation.paymentLinkExceedsCapacity'] },
    });
  });

  it('keeps a COMPLETED link reserved until it is settled (DT-199)', async () => {
    const world = buildWorld();
    await world.links.save(seeded({ status: 'COMPLETED', amount: '60.00', paymentId: 'pay_1' }));
    await expect(create(world, '40.01', REQ_1)).rejects.toMatchObject({
      fieldErrors: { amount: ['validation.paymentLinkExceedsCapacity'] },
    });
    expect((await create(world, '40', REQ_2)).amount).toBe('40.00');
  });

  it('counts a SETTLED link through the balance only and frees a DEACTIVATED one', async () => {
    const world = buildWorld();
    await world.links.save(seeded({ id: 's1', status: 'SETTLED', amount: '60.00' }));
    await world.links.save(
      seeded({ id: 'd1', requestId: REQ_3, status: 'DEACTIVATED', amount: '50.00' }),
    );
    // The invoice balance (100) already dropped for a settled payment in real life; the fake keeps 100.
    expect((await create(world, '100', REQ_1)).amount).toBe('100.00');
  });

  it('returns the same link for the same requestId and calls the provider once', async () => {
    const world = buildWorld();
    const first = await create(world, '40', REQ_1);
    const second = await create(world, '40', REQ_1);
    expect(second).toEqual(first);
    expect(world.provider.links.size).toBe(1);
    expect(await world.links.listByInvoice('inv_1')).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(1);
  });

  it('leaves the link PENDING when the provider fails; the retry reuses the same key', async () => {
    const world = buildWorld();
    world.provider.failCreate = 1;
    await expect(create(world, '40', REQ_1)).rejects.toThrow('provider down');
    const pending = await world.links.findByRequestId('inv_1', REQ_1);
    expect(pending).toMatchObject({ status: 'PENDING', externalId: null, amount: '40.00' });

    // The PENDING row still counts in the cap.
    await expect(create(world, '60.01', REQ_2)).rejects.toMatchObject({ code: 'VALIDATION' });

    const retried = await create(world, '40', REQ_1);
    expect(retried).toMatchObject({ id: 'lnk_1', status: 'ACTIVE', externalId: 'plink_fake_1' });
    expect(world.provider.createKeys).toEqual(['invoice-link:lnk_1', 'invoice-link:lnk_1']);
    expect(await world.links.listByInvoice('inv_1')).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(1);
  });

  it('returns a link that was deactivated meanwhile as it is, without calling the provider', async () => {
    const world = buildWorld();
    await create(world, '40', REQ_1);
    await world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' });
    const again = await create(world, '40', REQ_1);
    expect(again.status).toBe('DEACTIVATED');
    expect(world.provider.createKeys).toHaveLength(1);
  });

  it('deactivates the provider link when the row was deactivated while the call was in flight', async () => {
    const world = buildWorld();
    const original = world.provider.createPaymentLink.bind(world.provider);
    world.provider.createPaymentLink = async (input) => {
      const created = await original(input);
      await world.deactivate.execute(owner, { invoiceId: 'inv_1', linkId: 'lnk_1' });
      return created;
    };
    const out = await create(world, '40', REQ_1);
    expect(out.status).toBe('DEACTIVATED');
    expect(world.provider.links.get('plink_fake_1')?.active).toBe(false);
  });
});
