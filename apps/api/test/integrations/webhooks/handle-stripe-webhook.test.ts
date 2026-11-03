import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import {
  ConflictError,
  ForbiddenError,
  IntegrityLockedError,
  NotFoundError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../../../src/shared/domain';
import { buildWorld, eventOf, linkOf } from './world';

/** Stands for finance's `LockSetChangedError`, a `ConflictError` subclass. */
class LockSetChangedError extends ConflictError {}

describe('HandleStripeWebhook (DT-183, A11)', () => {
  it('records a link payment: amount, currency, fee, link and invoice resolved from the database', async () => {
    const w = buildWorld();
    expect(await w.deliver(eventOf())).toBe('processed');
    expect(w.recording.calls).toEqual([
      {
        provider: 'STRIPE',
        eventId: 'evt_1',
        eventType: 'payment_intent.succeeded',
        externalId: 'pi_1',
        clientId: 'cli_1',
        invoiceId: 'inv_1',
        linkId: 'lnk_1',
        amount: '60.00',
        currency: 'USD',
        fee: '2.04',
        receivedAt: new Date('2026-11-02T10:59:00Z'),
        accountId: 'acc_1',
        methodId: 'pm_1',
      },
    ]);
  });

  it('refuses a bad signature before anything is written', async () => {
    const w = buildWorld();
    const { rawBody } = w.provider.signedEvent(eventOf());
    await expect(
      w.handle.execute(SYSTEM_ACTOR, { rawBody, headers: { 'x-fake-signature': 'bad' } }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(w.events.all()).toHaveLength(0);
    expect(w.recording.calls).toHaveLength(0);
  });

  it('answers duplicate for the same event again and calls finance only once', async () => {
    const w = buildWorld();
    await w.deliver(eventOf());
    expect(await w.deliver(eventOf())).toBe('duplicate');
    expect(w.recording.calls).toHaveLength(1);
  });

  it('answers duplicate for a second event about the same provider payment (EXISTING)', async () => {
    const w = buildWorld();
    await w.deliver(eventOf());
    const second = eventOf({ eventId: 'evt_2', type: 'checkout.session.completed' });
    expect(await w.deliver(second)).toBe('duplicate');
  });

  it('answers duplicate when finance reports the event id was stored by a concurrent delivery', async () => {
    const w = buildWorld();
    w.recording.racedEvents.add('evt_1');
    expect(await w.deliver(eventOf())).toBe('duplicate');
  });

  it('ignores an unknown event type and stores it IGNORED', async () => {
    const w = buildWorld();
    const event = eventOf({
      eventId: 'evt_x',
      type: 'customer.created',
      kind: 'OTHER',
      paymentId: null,
      metadata: {},
    });
    expect(await w.deliver(event)).toBe('ignored');
    expect(await w.deliver(event)).toBe('duplicate');
    expect(w.events.all()).toMatchObject([
      { eventId: 'evt_x', outcome: 'IGNORED', reasonCode: null },
    ]);
    expect(w.recording.calls).toHaveLength(0);
  });

  it('parks a refund with REFUND and never touches a payment', async () => {
    const w = buildWorld();
    const event = eventOf({ eventId: 'evt_r', type: 'charge.refunded', kind: 'REFUND' });
    expect(await w.deliver(event)).toBe('parked');
    expect(w.events.all()).toMatchObject([{ outcome: 'PARKED', reasonCode: 'REFUND' }]);
    expect(w.recording.calls).toHaveLength(0);
  });

  it.each([
    ['no payment id on the event', () => ({ paymentId: null }), 'NO_PAYMENT'],
    [
      'a payment the provider does not know',
      () => ({ paymentId: 'pi_missing' }),
      'PAYMENT_NOT_FOUND',
    ],
  ])('parks %s', async (_name, over, reason) => {
    const w = buildWorld();
    expect(await w.deliver(eventOf(over()))).toBe('parked');
    expect(w.events.all()).toMatchObject([{ outcome: 'PARKED', reasonCode: reason }]);
    expect(w.recording.calls).toHaveLength(0);
  });

  it('parks NO_MAPPING when the Owner has not set the Stripe target', async () => {
    const w = buildWorld();
    w.mapping.set({});
    expect(await w.deliver(eventOf())).toBe('parked');
    expect(w.events.all()).toMatchObject([{ outcome: 'PARKED', reasonCode: 'NO_MAPPING' }]);
    expect(w.recording.calls).toHaveLength(0);
  });

  it('resolves the client from metadata.clientId when no link is named, without an invoice', async () => {
    const w = buildWorld();
    w.provider.addPayment({
      id: 'pi_2',
      amount: '25.00',
      currency: 'EUR',
      fee: null,
      paidAt: new Date('2026-11-02T10:00:00Z'),
      metadata: { clientId: 'cli_9' },
    });
    const event = eventOf({ eventId: 'evt_2', paymentId: 'pi_2', metadata: { clientId: 'cli_9' } });
    expect(await w.deliver(event)).toBe('processed');
    expect(w.recording.calls[0]).toMatchObject({
      clientId: 'cli_9',
      invoiceId: null,
      linkId: null,
      currency: 'EUR',
      fee: null,
    });
  });

  it('parks NO_CLIENT when the payment names neither a link nor a client', async () => {
    const w = buildWorld();
    w.provider.addPayment({
      id: 'pi_3',
      amount: '5.00',
      currency: 'USD',
      fee: null,
      paidAt: new Date('2026-11-02T10:00:00Z'),
      metadata: {},
    });
    expect(await w.deliver(eventOf({ eventId: 'evt_3', paymentId: 'pi_3', metadata: {} }))).toBe(
      'parked',
    );
    expect(w.events.all()).toMatchObject([{ reasonCode: 'NO_CLIENT' }]);
  });

  it('parks LINK_NOT_FOUND for a link id that is not ours (C14) and INVOICE_NOT_FOUND for a vanished invoice', async () => {
    const w = buildWorld();
    expect(await w.deliver(eventOf({ eventId: 'e1', metadata: { linkId: 'lnk_zzz' } }))).toBe(
      'parked',
    );
    await w.links.save(
      linkOf({
        id: 'lnk_2',
        invoiceId: 'inv_gone',
        requestId: '22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(await w.deliver(eventOf({ eventId: 'e2', metadata: { linkId: 'lnk_2' } }))).toBe(
      'parked',
    );
    expect(w.events.all().map((e) => e.reasonCode)).toEqual([
      'LINK_NOT_FOUND',
      'INVOICE_NOT_FOUND',
    ]);
  });

  it('parks CURRENCY_MISMATCH when the payment currency differs from the invoice', async () => {
    const w = buildWorld();
    w.provider.addPayment({
      id: 'pi_eur',
      amount: '60.00',
      currency: 'EUR',
      fee: null,
      paidAt: new Date('2026-11-02T10:00:00Z'),
      metadata: {},
    });
    expect(await w.deliver(eventOf({ paymentId: 'pi_eur' }))).toBe('parked');
    expect(w.events.all()).toMatchObject([{ reasonCode: 'CURRENCY_MISMATCH' }]);
    expect(w.recording.calls).toHaveLength(0);
  });

  it('answers parked when finance parks the event for a missing rate (finance stores that row)', async () => {
    const w = buildWorld();
    w.recording.parkWith = 'NO_RATE';
    expect(await w.deliver(eventOf())).toBe('parked');
    expect(w.events.all()).toMatchObject([{ outcome: 'PARKED', reasonCode: 'NO_RATE' }]);
  });

  it('parks an event finance refuses with a domain error (inactive account, client gone) in its own row', async () => {
    const w = buildWorld();
    w.recording.failWith = new NotFoundError();
    expect(await w.deliver(eventOf())).toBe('parked');
    expect(w.events.all()).toMatchObject([{ outcome: 'PARKED', reasonCode: 'INVALID_REFERENCE' }]);
    w.recording.failWith = new ValidationFailedError({
      fieldErrors: { currency: ['payments.currencyMismatch'] },
    });
    expect(await w.deliver(eventOf({ eventId: 'evt_b' }))).toBe('parked');
    expect(w.events.all().map((e) => e.reasonCode)).toEqual([
      'INVALID_REFERENCE',
      'CURRENCY_MISMATCH',
    ]);
  });

  it('lets a conflict (exhausted serialization retries, changed lock set) escape so Stripe retries, and stores nothing', async () => {
    const w = buildWorld();
    w.recording.failWith = new ConflictError();
    await expect(w.deliver(eventOf())).rejects.toBeInstanceOf(ConflictError);
    w.recording.failWith = new LockSetChangedError();
    await expect(w.deliver(eventOf())).rejects.toBeInstanceOf(LockSetChangedError);
    expect(w.events.all()).toHaveLength(0);
    // The same event delivered again once the conflict is gone is processed, not "duplicate".
    w.recording.failWith = null;
    expect(await w.deliver(eventOf())).toBe('processed');
  });

  it('parks an integrity lock refusal as INVALID_REFERENCE', async () => {
    const w = buildWorld();
    w.recording.failWith = new IntegrityLockedError();
    expect(await w.deliver(eventOf())).toBe('parked');
    expect(w.events.all()).toMatchObject([{ outcome: 'PARKED', reasonCode: 'INVALID_REFERENCE' }]);
  });

  it('parks CURRENCY_UNSUPPORTED when the provider payment is in a currency we do not charge', async () => {
    const w = buildWorld();
    w.provider.failRetrieveWith = new ValidationFailedError({
      message: 'validation.paymentLinkCurrencyUnsupported',
    });
    expect(await w.deliver(eventOf())).toBe('parked');
    expect(w.events.all()).toMatchObject([
      { outcome: 'PARKED', reasonCode: 'CURRENCY_UNSUPPORTED' },
    ]);
    expect(w.recording.calls).toHaveLength(0);
  });

  it('parks PAYMENT_NOT_SUCCEEDED when the provider payment has not succeeded', async () => {
    const w = buildWorld();
    w.provider.failRetrieveWith = new ValidationFailedError({
      message: 'integrations.stripe.paymentNotSucceeded',
    });
    expect(await w.deliver(eventOf())).toBe('parked');
    expect(w.events.all()).toMatchObject([
      { outcome: 'PARKED', reasonCode: 'PAYMENT_NOT_SUCCEEDED' },
    ]);
    expect(w.recording.calls).toHaveLength(0);
  });

  it('lets an unexpected failure escape so Stripe retries, and stores nothing', async () => {
    const w = buildWorld();
    w.recording.failWith = new Error('db down');
    await expect(w.deliver(eventOf())).rejects.toThrow('db down');
    expect(w.events.all()).toHaveLength(0);
  });

  it('only the SYSTEM actor may run it (DT-130)', async () => {
    const w = buildWorld();
    const { rawBody, headers } = w.provider.signedEvent(eventOf());
    await expect(
      w.handle.execute({ actorType: 'USER', userId: 'usr_1' }, { rawBody, headers }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
