import { roundMoney, sumMoney } from '../../../../../shared/domain';
import { STRIPE_LINK_CURRENCIES, linkCapacity } from '../../../domain/link-capacity';
import { isOpenLinkStatus, type PaymentLink } from '../../../domain/payment-link';
import type { InvoiceForLink } from '../../ports/invoice-for-link.port';

/** i18n keys of the link use cases (the BE returns keys, never text). */
export const PAYMENT_LINK_MESSAGES = {
  invoiceNotOpen: 'integrations.paymentLink.invoiceNotOpen',
  invalidRequestId: 'validation.uuid.invalid',
} as const;

/** `deactivationReason` of a link a user closed by hand. */
export const MANUAL_DEACTIVATION_REASON = 'MANUAL';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

/** A payment link as the API returns it: money as a decimal string, dates as ISO 8601 UTC. */
export interface PaymentLinkOutput {
  readonly id: string;
  readonly invoiceId: string;
  readonly requestId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentLink['status'];
  readonly url: string | null;
  readonly externalId: string | null;
  readonly paymentId: string | null;
  readonly deactivationReason: string | null;
  readonly createdAt: string;
  readonly deactivatedAt: string | null;
  readonly settledAt: string | null;
}

export function toPaymentLinkOutput(link: PaymentLink): PaymentLinkOutput {
  return {
    id: link.id,
    invoiceId: link.invoiceId,
    requestId: link.requestId,
    amount: link.amount,
    currency: link.currency,
    status: link.status,
    url: link.url,
    externalId: link.externalId,
    paymentId: link.paymentId,
    deactivationReason: link.deactivationReason,
    createdAt: link.createdAt.toISOString(),
    deactivatedAt: link.deactivatedAt?.toISOString() ?? null,
    settledAt: link.settledAt?.toISOString() ?? null,
  };
}

export const openLinksOf = (links: readonly PaymentLink[]): PaymentLink[] =>
  links.filter((link) => isOpenLinkStatus(link.status));

/** DT-199: a `COMPLETED` link keeps its amount reserved until its payment is allocated or voided. */
export function reservedOf(links: readonly PaymentLink[]): string {
  return roundMoney(
    sumMoney(links.filter((link) => link.status === 'COMPLETED').map((link) => link.amount)),
  );
}

export const canCarryLinks = (invoice: InvoiceForLink): boolean =>
  invoice.open && (STRIPE_LINK_CURRENCIES as readonly string[]).includes(invoice.currency);

/** What a new link may still carry; zero for an invoice that cannot carry links at all. */
export function capacityOf(invoice: InvoiceForLink, links: readonly PaymentLink[]): string {
  if (!canCarryLinks(invoice)) return roundMoney('0');
  return linkCapacity(invoice.openBalance, openLinksOf(links), reservedOf(links));
}
