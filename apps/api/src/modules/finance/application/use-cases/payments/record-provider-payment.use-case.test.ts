import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACC_VES,
  KAIROS,
  command,
  createProviderPaymentWorld,
  type ProviderPaymentWorld,
} from '../../../../../../test/finance/provider-payment-world';
import { rejection } from '../../../../../../test/finance/payments/world';
import { INVOICE_CLIENT_MISMATCH } from './record-provider-payment.use-case';

let world: ProviderPaymentWorld;

beforeEach(() => {
  world = createProviderPaymentWorld();
});

const run = (over = {}) => world.record.execute(world.system, command(over));

describe('recordProviderPayment: a payment from a provider event', () => {
  it('refuses any actor that is not SYSTEM and writes nothing', async () => {
    const actor = { actorType: 'USER', userId: 'usr_1' } as const;
    expect((await rejection(world.record.execute(actor, command()))).code).toBe('FORBIDDEN');
    expect(world.payments.all).toHaveLength(0);
    expect(world.events.all).toHaveLength(0);
  });

  it('writes a PENDIENTE_VERIFICACION, unallocated payment with the provider identity and fee', async () => {
    const result = await run();

    expect(result).toMatchObject({ outcome: 'RECORDED' });
    const [payment] = world.payments.all;
    expect(payment).toMatchObject({
      clientId: KAIROS,
      status: 'PENDIENTE_VERIFICACION',
      amount: '100.00',
      feeAmount: '3.20',
      igtfAmount: '0.00',
      netCredited: '96.80',
      allocatable: '100.00',
      unallocated: '100.00',
      usdRate: '1.00000000',
      amountUsd: '100.00',
      reference: 'pi_1',
      date: '2026-10-09',
      createdById: null,
      code: 'PAG-0001',
    });
    expect(world.settlement.referenceOf('STRIPE', 'pi_1')).toBe(payment?.id);
    expect(world.payments.allAllocations).toHaveLength(0);
  });

  it('stores the event PROCESSED against the payment, in one Serializable unit of work', async () => {
    await run();

    expect(world.events.all).toEqual([
      expect.objectContaining({
        provider: 'STRIPE',
        eventId: 'evt_1',
        type: 'payment_intent.succeeded',
        outcome: 'PROCESSED',
        reasonCode: null,
        entityType: 'PAYMENT',
        entityId: world.payments.all[0]?.id,
      }),
    ]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('takes the rate of the payment date once and keeps the USD snapshot', async () => {
    world.rates.set('VES', '2026-10-09', '40');

    await run({ accountId: ACC_VES, currency: 'VES', amount: '400.00', fee: null });

    expect(world.payments.all[0]).toMatchObject({
      currency: 'VES',
      usdRate: '40.00000000',
      amount: '400.00',
      amountUsd: '10.00',
      feeAmount: '0.00',
    });
  });

  it('dates the payment by the Caracas day of the event, not the UTC day', async () => {
    await run({ receivedAt: new Date('2026-10-10T02:30:00.000Z') });

    expect(world.payments.all[0]?.date).toBe('2026-10-09');
  });

  it('writes the facts, the search entry and one CREATE entry by the SYSTEM actor', async () => {
    await run({ linkId: null });

    const payment = world.payments.all[0];
    expect(world.projector.calls).toEqual([
      `payment:${payment?.id}`,
      'account:acc_usd',
      `clients:${KAIROS}`,
    ]);
    expect(world.search.get('PAYMENT', payment?.id ?? '')).toMatchObject({
      status: 'PENDIENTE_VERIFICACION',
    });
    expect(world.activity.entries).toEqual([
      expect.objectContaining({
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'CREATE',
        entityType: 'PAYMENT',
        entityId: payment?.id,
        metadata: expect.objectContaining({
          provider: 'STRIPE',
          eventId: 'evt_1',
          externalId: 'pi_1',
        }),
      }),
    ]);
  });

  it('locks the client and the account in one call, invoice included when the event names one', async () => {
    world.addInvoice('inv_a', '100.00');
    await run({ invoiceId: 'inv_a' });

    expect(world.locks.acquired.map((row) => row.rowClass)).toEqual([
      'Client',
      'Invoice',
      'Account',
    ]);
  });

  it('a repeated delivery of the same event answers DUPLICATE and writes nothing more', async () => {
    await run();
    const activity = world.activity.entries.length;

    const second = await run();

    expect(second).toEqual({ outcome: 'DUPLICATE' });
    expect(world.payments.all).toHaveLength(1);
    expect(world.events.all).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(activity);
  });

  it('another event for a payment already recorded is EXISTING and creates no second payment', async () => {
    const first = await run();
    const second = await run({ eventId: 'evt_2', eventType: 'checkout.session.completed' });

    expect(second).toEqual({
      outcome: 'EXISTING',
      paymentId: first.outcome === 'RECORDED' ? first.paymentId : '',
    });
    expect(world.payments.all).toHaveLength(1);
    expect(world.events.all.map((row) => row.eventId)).toEqual(['evt_1', 'evt_2']);
  });

  it('an event id already stored for another provider payment answers DUPLICATE and writes no payment', async () => {
    await run();

    const second = await run({ externalId: 'pi_2' });

    expect(second).toEqual({ outcome: 'DUPLICATE' });
    expect(world.payments.all).toHaveLength(1);
    expect(world.events.all).toHaveLength(1);
  });

  it('a sibling event committed while waiting for the locks rolls back and answers EXISTING on the next pass', async () => {
    const lookup = vi
      .spyOn(world.settlement, 'findPaymentId')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('pay_sibling')
      .mockResolvedValue('pay_sibling');

    const result = await run();

    expect(result).toEqual({ outcome: 'EXISTING', paymentId: 'pay_sibling' });
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(world.payments.all).toHaveLength(0);
    expect(world.events.all).toEqual([
      expect.objectContaining({ eventId: 'evt_1', entityType: 'PAYMENT', entityId: 'pay_sibling' }),
    ]);
  });

  it('without a rate the event is parked NO_RATE and nothing else is written', async () => {
    const result = await run({ accountId: ACC_VES, currency: 'VES' });

    expect(result).toEqual({ outcome: 'PARKED', reasonCode: 'NO_RATE' });
    expect(world.events.all).toEqual([
      expect.objectContaining({
        outcome: 'PARKED',
        reasonCode: 'NO_RATE',
        entityType: null,
        entityId: null,
      }),
    ]);
    expect(world.payments.all).toHaveLength(0);
    expect(world.activity.entries).toHaveLength(0);
    expect(world.projector.calls).toHaveLength(0);
    expect(world.sequence).toBeDefined();
  });

  it('a parked event is not parked twice', async () => {
    await run({ accountId: ACC_VES, currency: 'VES' });

    expect(await run({ accountId: ACC_VES, currency: 'VES' })).toEqual({ outcome: 'DUPLICATE' });
    expect(world.events.all).toHaveLength(1);
  });
});

describe('recordProviderPayment: the payment link (A13)', () => {
  const link = (over = {}) => ({
    id: 'lnk_1',
    invoiceId: 'inv_a',
    amount: '100.00',
    status: 'ACTIVE' as const,
    paymentId: null,
    ...over,
  });

  it('sets the ACTIVE link COMPLETED with the payment in the same unit of work', async () => {
    world.addInvoice('inv_a', '100.00');
    world.settlement.seedLink(link());

    const result = await run({ invoiceId: 'inv_a', linkId: 'lnk_1' });

    expect(world.settlement.link('lnk_1')).toMatchObject({
      status: 'COMPLETED',
      paymentId: result.outcome === 'RECORDED' ? result.paymentId : '',
    });
    expect(world.activity.entries[0]?.metadata).toMatchObject({
      linkId: 'lnk_1',
      linkCompleted: true,
    });
  });

  it('a payment through an already deactivated link is still recorded (A10) and the link is left alone', async () => {
    world.addInvoice('inv_a', '100.00');
    world.settlement.seedLink(link({ status: 'DEACTIVATED' }));

    const result = await run({ invoiceId: 'inv_a', linkId: 'lnk_1' });

    expect(result.outcome).toBe('RECORDED');
    expect(world.settlement.link('lnk_1')).toMatchObject({
      status: 'DEACTIVATED',
      paymentId: null,
    });
    expect(world.activity.entries[0]?.metadata).toMatchObject({ linkCompleted: false });
  });

  it('a link of another invoice is not completed', async () => {
    world.addInvoice('inv_a', '100.00');
    world.settlement.seedLink(link({ invoiceId: 'inv_other' }));

    await run({ invoiceId: 'inv_a', linkId: 'lnk_1' });

    expect(world.settlement.link('lnk_1')).toMatchObject({ status: 'ACTIVE' });
  });
});

describe('recordProviderPayment: references are checked, never trusted (C14)', () => {
  it('an unknown client is NOT_FOUND and the event row rolls back with the payment', async () => {
    expect((await rejection(run({ clientId: 'cli_ghost' }))).code).toBe('NOT_FOUND');

    expect(world.payments.all).toHaveLength(0);
    expect(world.events.all).toHaveLength(0);
  });

  it('an invoice of another client is refused with nothing written', async () => {
    world.addInvoice('inv_z', '100.00', { clientId: 'cli_zafiro' });

    const error = await rejection(run({ invoiceId: 'inv_z' }));

    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { invoiceId: [INVOICE_CLIENT_MISMATCH] },
    });
    expect(world.payments.all).toHaveLength(0);
    expect(world.events.all).toHaveLength(0);
  });

  it('an unknown invoice is NOT_FOUND', async () => {
    expect((await rejection(run({ invoiceId: 'inv_ghost' }))).code).toBe('NOT_FOUND');
  });

  it('an account of another currency is refused', async () => {
    world.rates.set('EUR', '2026-10-09', '0.9');
    expect(await rejection(run({ currency: 'EUR' }))).toMatchObject({ code: 'VALIDATION' });
    expect(world.events.all).toHaveLength(0);
  });

  it('a fee above the amount is refused before anything is stored', async () => {
    expect(await rejection(run({ fee: '150.00' }))).toMatchObject({ code: 'VALIDATION' });
    expect(world.events.all).toHaveLength(0);
  });
});
