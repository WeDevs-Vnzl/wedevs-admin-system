import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  compareMoney,
  IntegrityLockedError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../../shared/domain';
import { PAYMENT_LINK_MINIMUM, validateLinkRequest } from '../../../domain/link-capacity';
import { activateLink, type PaymentLink } from '../../../domain/payment-link';
import type { InvoiceForLink, InvoiceForLinkPort } from '../../ports/invoice-for-link.port';
import type { PaymentLinkRepository } from '../../ports/payment-link.repository.port';
import type { PaymentProviderPort } from '../../ports/payment-provider.port';
import {
  PAYMENT_LINK_MESSAGES,
  capacityOf,
  isUuid,
  toPaymentLinkOutput,
  type PaymentLinkOutput,
} from './payment-link-support';

export interface CreateInvoicePaymentLinkInput {
  readonly invoiceId: string;
  /** Decimal string in the invoice currency. */
  readonly amount: string;
  /** UUID the caller generates per click; a repeated request returns the link it created. */
  readonly requestId: string;
}

/**
 * `CreateInvoicePaymentLink` (choice 5, DT-196, DT-197, A13). `payment` `create` first. A `Serializable` unit
 * of work takes the `Invoice` row lock before anything else, answers a repeated `requestId` with its link,
 * reads the balance and the links, checks currency, minimum and capacity and inserts the link `PENDING`.
 * The provider call runs after the commit with the key `invoice-link:{linkId}`; a short unit of work then
 * sets `ACTIVE`, `url` and `externalId`. A failed call leaves the row `PENDING` (it still counts in the cap)
 * and a retry with the same `requestId` repeats the call with the same key.
 */
export class CreateInvoicePaymentLink {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly invoices: InvoiceForLinkPort,
    private readonly links: PaymentLinkRepository,
    private readonly provider: PaymentProviderPort,
    private readonly locks: RowLocksPort,
    private readonly activityLog: ActivityLogPort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: CreateInvoicePaymentLinkInput,
  ): Promise<PaymentLinkOutput> {
    assertCan(this.authorization, actor, 'create', 'payment');
    if (!isUuid(input.requestId)) {
      throw new ValidationFailedError({
        message: PAYMENT_LINK_MESSAGES.invalidRequestId,
        fieldErrors: { requestId: [PAYMENT_LINK_MESSAGES.invalidRequestId] },
      });
    }
    const link = await this.uow.run(() => this.reserve(actor, input), {
      isolation: 'Serializable',
    });
    if (link.status !== 'PENDING') return toPaymentLinkOutput(link);
    return toPaymentLinkOutput(await this.dispatch(link));
  }

  /** The locked, capacity-checked insert. Database effects only: a serialization failure reruns it. */
  private async reserve(
    actor: CurrentUser,
    input: CreateInvoicePaymentLinkInput,
  ): Promise<PaymentLink> {
    await this.locks.lock({ Invoice: [input.invoiceId] });
    const existing = await this.links.findByRequestId(input.invoiceId, input.requestId);
    if (existing) return existing;

    const invoice = await this.invoices.load(input.invoiceId);
    if (!invoice.open) {
      throw new IntegrityLockedError({ message: PAYMENT_LINK_MESSAGES.invoiceNotOpen });
    }
    const all = await this.links.listByInvoice(invoice.id);
    const amount = this.validate(invoice, input.amount, capacityOf(invoice, all));

    const link: PaymentLink = {
      id: this.ids.next(),
      invoiceId: invoice.id,
      requestId: input.requestId,
      provider: 'STRIPE',
      externalId: null,
      url: null,
      amount,
      currency: invoice.currency,
      status: 'PENDING',
      paymentId: null,
      deactivationReason: null,
      createdAt: this.clock.now(),
      createdById: actor.userId,
      deactivatedAt: null,
      settledAt: null,
    };
    await this.links.save(link);
    // No client scope on purpose: touching the client here would lock it after the invoice (DT-126, A13).
    await this.activityLog.record({
      actor: actorOf(actor),
      action: 'CREATE',
      entityType: 'PAYMENT_LINK',
      entityId: link.id,
      entityLabel: `${invoice.number} ${amount} ${invoice.currency}`,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        clientId: invoice.clientId,
        amount,
        currency: invoice.currency,
      },
    });
    return link;
  }

  /**
   * `validateLinkRequest`, with one adjustment: when what is left is already below the minimum, any amount
   * exceeds the capacity, so that is the answer (a client sees "nothing left", not "below the minimum").
   */
  private validate(invoice: InvoiceForLink, amount: string, capacity: string): string {
    try {
      return validateLinkRequest(invoice.currency, amount, capacity);
    } catch (error) {
      if (
        error instanceof ValidationFailedError &&
        error.message === 'validation.paymentLinkBelowMinimum' &&
        compareMoney(capacity, PAYMENT_LINK_MINIMUM) < 0
      ) {
        throw new ValidationFailedError({
          message: 'validation.paymentLinkExceedsCapacity',
          fieldErrors: { amount: ['validation.paymentLinkExceedsCapacity'] },
        });
      }
      throw error;
    }
  }

  /** The provider call, outside any transaction, then the short unit of work that activates the link. */
  private async dispatch(link: PaymentLink): Promise<PaymentLink> {
    const invoice: InvoiceForLink = await this.invoices.load(link.invoiceId);
    const created = await this.provider.createPaymentLink({
      idempotencyKey: `invoice-link:${link.id}`,
      amount: link.amount,
      currency: link.currency,
      description: `Invoice ${invoice.number}`,
      metadata: { invoiceId: link.invoiceId, linkId: link.id },
    });
    const settled = await this.uow.run(async () => {
      await this.locks.lock({ Invoice: [link.invoiceId] });
      const current = await this.links.findById(link.id);
      if (!current) throw new NotFoundError();
      if (current.status !== 'PENDING')
        return { current, orphaned: current.status === 'DEACTIVATED' };
      const active = activateLink(current, created);
      await this.links.save(active);
      return { current: active, orphaned: false };
    });
    // Deactivated while the provider call was in flight: the provider link must not stay live.
    if (settled.orphaned) await this.provider.deactivatePaymentLink(created.externalId);
    return settled.current;
  }
}
