import { ConflictError } from '../../../shared/domain';
import type { IntegrationProvider } from './integration-event';

/**
 * Payment link lifecycle (DT-182, DT-196, DT-199): PENDING -> ACTIVE -> COMPLETED -> SETTLED, and
 * PENDING | ACTIVE -> DEACTIVATED; a SETTLED link whose allocation was removed goes back to COMPLETED. Every function returns a new link and refuses an illegal step.
 */
export const PAYMENT_LINK_STATUS_VALUES = [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'SETTLED',
  'DEACTIVATED',
] as const;
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUS_VALUES)[number];

export interface PaymentLink {
  readonly id: string;
  readonly invoiceId: string;
  /** UUID the caller generates per click; unique per invoice (idempotent creation). */
  readonly requestId: string;
  readonly provider: IntegrationProvider;
  readonly externalId: string | null;
  readonly url: string | null;
  /** Decimal string in the invoice currency. */
  readonly amount: string;
  readonly currency: string;
  readonly status: PaymentLinkStatus;
  readonly paymentId: string | null;
  readonly deactivationReason: string | null;
  readonly createdAt: Date;
  readonly createdById: string;
  readonly deactivatedAt: Date | null;
  readonly settledAt: Date | null;
}

const TRANSITIONS: Readonly<Record<PaymentLinkStatus, readonly PaymentLinkStatus[]>> = {
  PENDING: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['COMPLETED', 'DEACTIVATED'],
  COMPLETED: ['SETTLED'],
  SETTLED: ['COMPLETED'],
  DEACTIVATED: [],
};

export function canTransitionLink(from: PaymentLinkStatus, to: PaymentLinkStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A link still able to take a payment; its amount counts against the capacity. */
export function isOpenLinkStatus(status: PaymentLinkStatus): boolean {
  return status === 'PENDING' || status === 'ACTIVE';
}

function assertTransition(link: PaymentLink, to: PaymentLinkStatus): void {
  if (canTransitionLink(link.status, to)) return;
  throw new ConflictError({ message: 'integrations.paymentLink.illegalTransition' });
}

export function activateLink(
  link: PaymentLink,
  provided: { readonly externalId: string; readonly url: string },
): PaymentLink {
  assertTransition(link, 'ACTIVE');
  return { ...link, status: 'ACTIVE', externalId: provided.externalId, url: provided.url };
}

export function completeLink(link: PaymentLink, paymentId: string): PaymentLink {
  assertTransition(link, 'COMPLETED');
  return { ...link, status: 'COMPLETED', paymentId };
}

export function settleLink(link: PaymentLink, at: Date): PaymentLink {
  assertTransition(link, 'SETTLED');
  return { ...link, status: 'SETTLED', settledAt: at };
}

/** DT-199: the allocation that settled the link was removed; its amount is reserved again. */
export function unsettleLink(link: PaymentLink): PaymentLink {
  assertTransition(link, 'COMPLETED');
  return { ...link, status: 'COMPLETED', settledAt: null };
}

export function deactivateLink(link: PaymentLink, reason: string, at: Date): PaymentLink {
  assertTransition(link, 'DEACTIVATED');
  return { ...link, status: 'DEACTIVATED', deactivationReason: reason, deactivatedAt: at };
}
