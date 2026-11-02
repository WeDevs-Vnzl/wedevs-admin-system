import type { Actor } from '../../../../../shared/application/actor';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { SequencePort } from '../../../../../shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import {
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../../shared/domain/domain-error';
import { toUsd } from '../../../../../shared/domain/money';
import type {
  IntegrationEventStore,
  IntegrationEventEntry,
} from '../../../../integrations/application/ports/integration-event-store.port';
import type { RecordProviderPaymentInput } from '../../../../integrations/application/ports/provider-payment-recorder.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import type {
  PaymentLinkSettlementPort,
  ProviderPaymentReferencePort,
} from '../../ports/payment-link-settlement.port';
import type { PaymentRecord } from '../../ports/payment.repository.port';
import { normalizePaymentFields, paymentFieldErrors, type PaymentFields } from './payment-input';
import {
  MAX_PLAN_ATTEMPTS,
  LockSetChangedError,
  derivedColumns,
  type PaymentSupport,
} from './payment-support';

/** The invoice a provider event names belongs to another client than the event's. */
export const INVOICE_CLIENT_MISMATCH = 'payments.validation.providerInvoiceClientMismatch';

/**
 * What `ProviderPaymentRecorderPort.record` receives plus what finance cannot derive: the event type for the
 * event row and the (account, method) the settings mapping names (DT-183). Both come from the caller.
 */
export interface RecordProviderPaymentCommand extends RecordProviderPaymentInput {
  readonly eventType: string;
  readonly accountId: string;
  readonly methodId: string;
}

export type RecordProviderPaymentResult =
  /** A `PENDIENTE_VERIFICACION`, unallocated payment was written and the event stored `PROCESSED`. */
  | { readonly outcome: 'RECORDED'; readonly paymentId: string }
  /** The provider's payment id was already recorded (by another event): the event is stored, nothing new. */
  | { readonly outcome: 'EXISTING'; readonly paymentId: string }
  /** `(provider, eventId)` was already stored: nothing was written. */
  | { readonly outcome: 'DUPLICATE' }
  /** No USD rate for the payment date: the event is stored `PARKED` / `NO_RATE`, nothing else is written. */
  | { readonly outcome: 'PARKED'; readonly reasonCode: 'NO_RATE' };

/**
 * `RecordProviderPayment` (A6, DT-183, PRD §12): a payment received through a provider (Stripe, later Binance)
 * becomes a `PENDIENTE_VERIFICACION`, unallocated payment that a partner confirms and allocates through the
 * existing flows. It never goes through `CreatePayment` with a made-up user: the caller is the `SYSTEM` actor.
 *
 * One `Serializable` unit of work, in the global order (DT-126): the `IntegrationEvent` row first (a repeated
 * delivery fails on the unique before any lock is taken and answers `DUPLICATE`), then every lock in one call
 * (`Client → Invoice → Account`), the references (C14), the payment with its provider identity, the link
 * `COMPLETED` with its payment (A13), the facts, balance and metrics, the search entry and the `CREATE` entry.
 * The USD snapshot is the rate of the date, taken once (C16); without one the event is parked and nothing else
 * is written.
 */
export class RecordProviderPayment {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly support: PaymentSupport,
    private readonly sequence: SequencePort,
    private readonly ids: IdGeneratorPort,
    private readonly events: IntegrationEventStore,
    private readonly rates: ExchangeRatePort,
    private readonly links: PaymentLinkSettlementPort,
    private readonly references: ProviderPaymentReferencePort,
  ) {}

  async execute(
    actor: Actor,
    input: RecordProviderPaymentCommand,
  ): Promise<RecordProviderPaymentResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();

    const date = todayInCaracas(input.receivedAt);
    const plan = {
      clientIds: [input.clientId],
      accountIds: [input.accountId],
      invoiceIds: input.invoiceId ? [input.invoiceId] : [],
    };
    for (let attempt = 1; ; attempt += 1) {
      const locks = await this.support.plan(plan);
      try {
        return await this.uow.run(() => this.record(input, date, locks), {
          isolation: 'Serializable',
        });
      } catch (error) {
        if (!(error instanceof LockSetChangedError) || attempt >= MAX_PLAN_ATTEMPTS) throw error;
      }
    }
  }

  private async record(
    input: RecordProviderPaymentCommand,
    date: string,
    plan: Awaited<ReturnType<PaymentSupport['plan']>>,
  ): Promise<RecordProviderPaymentResult> {
    const base = {
      provider: input.provider,
      eventId: input.eventId,
      type: input.eventType,
      receivedAt: input.receivedAt,
      processedAt: input.receivedAt,
    } as const;
    const stored = (over: Partial<IntegrationEventEntry>): IntegrationEventEntry => ({
      ...base,
      outcome: 'PROCESSED',
      reasonCode: null,
      entityType: null,
      entityId: null,
      ...over,
    });

    const selected = await this.rates.getRateFor(date, input.currency);
    const existingId = await this.references.findPaymentId(input.provider, input.externalId);

    if (existingId) {
      const result = await this.events.record(
        stored({ entityType: 'PAYMENT', entityId: existingId }),
      );
      return result === 'DUPLICATE'
        ? { outcome: 'DUPLICATE' }
        : { outcome: 'EXISTING', paymentId: existingId };
    }
    if (!selected) {
      const result = await this.events.record(stored({ outcome: 'PARKED', reasonCode: 'NO_RATE' }));
      return result === 'DUPLICATE'
        ? { outcome: 'DUPLICATE' }
        : { outcome: 'PARKED', reasonCode: 'NO_RATE' };
    }

    const fields: PaymentFields = {
      clientId: input.clientId,
      date,
      accountId: input.accountId,
      methodId: input.methodId,
      currency: input.currency,
      amount: input.amount,
      igtfAmount: '0',
      feeAmount: input.fee ?? '0',
      usdRate: selected.usdRate,
      reference: input.externalId,
    };
    const errors = paymentFieldErrors(fields);
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
    const values = normalizePaymentFields(fields);

    const paymentId = this.ids.next();
    const result = await this.events.record(stored({ entityType: 'PAYMENT', entityId: paymentId }));
    if (result === 'DUPLICATE') return { outcome: 'DUPLICATE' };

    await this.support.lockPlan(plan);
    // Another event for the same provider payment (payment_intent.succeeded and checkout.session.completed)
    // may have committed while this one waited for the client lock: roll back and answer EXISTING on the next
    // pass instead of letting the partial unique on (externalProvider, externalId) reject the insert.
    if (await this.references.findPaymentId(input.provider, input.externalId)) {
      throw new LockSetChangedError();
    }
    await this.support.requireClient(values.clientId);
    await this.support.requireAccount(values.accountId, values.currency, true);
    await this.support.requireMethod(values.methodId, values.reference);
    if (input.invoiceId) {
      const invoice = await this.support.invoices.findById(input.invoiceId);
      if (!invoice) throw new NotFoundError();
      if (invoice.clientId !== values.clientId) {
        throw new ValidationFailedError({
          fieldErrors: { invoiceId: [INVOICE_CLIENT_MISMATCH] },
        });
      }
    }

    const amounts = derivedColumns(values, []);
    const now = this.support.nowIso();
    const record: PaymentRecord = {
      id: paymentId,
      code: await this.sequence.next('PAG'),
      clientId: values.clientId,
      date: values.date,
      accountId: values.accountId,
      methodId: values.methodId,
      currency: values.currency,
      amount: values.amount,
      igtfAmount: values.igtfAmount,
      feeAmount: values.feeAmount,
      ...amounts,
      usdRate: values.usdRate,
      amountUsd: toUsd(values.amount, values.usdRate),
      reference: values.reference,
      status: 'PENDIENTE_VERIFICACION',
      receiptFileId: null,
      createdAt: now,
      updatedAt: now,
      createdById: null,
      updatedById: null,
    };
    await this.support.payments.insert(record);
    await this.references.stamp(record.id, input.provider, input.externalId);
    const linkCompleted =
      input.linkId && input.invoiceId
        ? await this.links.complete({
            linkId: input.linkId,
            invoiceId: input.invoiceId,
            paymentId: record.id,
          })
        : false;

    await this.support.settle({
      actor: { actorType: 'SYSTEM', userId: null },
      action: 'CREATE',
      before: null,
      after: record,
      invoiceIds: [],
      metadata: {
        provider: input.provider,
        eventId: input.eventId,
        externalId: input.externalId,
        ...(input.linkId ? { linkId: input.linkId, linkCompleted } : {}),
      },
    });
    return { outcome: 'RECORDED', paymentId: record.id };
  }
}
