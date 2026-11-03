import {
  MONEY_DECIMALS,
  ValidationFailedError,
  addMoney,
  compareMoney,
  isDecimalString,
  roundMoney,
  subMoney,
  sumMoney,
} from '../../../shared/domain';
import { isOpenLinkStatus, type PaymentLinkStatus } from './payment-link';

/**
 * Payment link capacity rules (choice 5, DT-196, DT-197, DT-199). Money is the invoice currency, kept as
 * decimal strings and computed with decimal.js through the shared money helpers (C15).
 */

/** Currencies Stripe charges that WeDevs uses (DT-197). Adding one is a new DT. */
export const STRIPE_LINK_CURRENCIES = ['USD', 'EUR'] as const;
/** Stripe's floor for both currencies. */
export const PAYMENT_LINK_MINIMUM = '0.50';
/**
 * A `PENDING` link older than this never reached the provider; an `ACTIVE` one points at a Checkout Session
 * that Stripe expired on its own (default 24 h). The daily job deactivates both.
 */
export const PENDING_LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface OpenLinkForCapacity {
  readonly id: string;
  readonly amount: string;
  readonly createdAt: Date;
  readonly status: PaymentLinkStatus;
}

export type LinkDeactivationReason =
  | 'INVOICE_NOT_OPEN'
  | 'PENDING_EXPIRED'
  | 'LINK_EXPIRED'
  | 'BALANCE_SHRUNK';

export interface LinkDeactivation {
  readonly linkId: string;
  readonly reason: LinkDeactivationReason;
}

function assertDecimal(value: string, field: string): void {
  if (!isDecimalString(value)) {
    throw new ValidationFailedError({
      message: 'validation.money.invalid',
      fieldErrors: { [field]: ['validation.money.invalid'] },
    });
  }
}

function floorAtZero(value: string): string {
  return compareMoney(value, '0') < 0 ? roundMoney('0') : roundMoney(value);
}

/**
 * What a new link may still carry: `openBalance - sum(open links) - reserved`, never below zero.
 * `reserved` is the amount of `COMPLETED` links whose payment is not yet allocated or voided.
 */
export function linkCapacity(
  openBalance: string,
  openLinks: readonly Pick<OpenLinkForCapacity, 'amount'>[],
  reserved: string,
): string {
  assertDecimal(openBalance, 'openBalance');
  assertDecimal(reserved, 'reserved');
  const committed = addMoney(sumMoney(openLinks.map((link) => link.amount)), reserved);
  return floorAtZero(subMoney(openBalance, committed));
}

/**
 * Checks a creation request and returns the amount normalized to two decimals. The currency comes
 * first (DT-197), then the minimum, then the capacity; each failure carries its i18n key.
 */
export function validateLinkRequest(currency: string, amount: string, capacity: string): string {
  if (!(STRIPE_LINK_CURRENCIES as readonly string[]).includes(currency)) {
    throw new ValidationFailedError({ message: 'validation.paymentLinkCurrencyUnsupported' });
  }
  const fractionDigits = isDecimalString(amount) ? (amount.split('.')[1]?.length ?? 0) : 0;
  if (!isDecimalString(amount) || fractionDigits > MONEY_DECIMALS) {
    throw new ValidationFailedError({
      message: 'validation.money.invalid',
      fieldErrors: { amount: ['validation.money.invalid'] },
    });
  }
  const normalized = roundMoney(amount);
  if (compareMoney(normalized, PAYMENT_LINK_MINIMUM) < 0) {
    throw new ValidationFailedError({
      message: 'validation.paymentLinkBelowMinimum',
      fieldErrors: { amount: ['validation.paymentLinkBelowMinimum'] },
    });
  }
  if (compareMoney(normalized, capacity) > 0) {
    throw new ValidationFailedError({
      message: 'validation.paymentLinkExceedsCapacity',
      fieldErrors: { amount: ['validation.paymentLinkExceedsCapacity'] },
    });
  }
  return normalized;
}

/** Newest first; a creation-time tie goes to the larger id so the order is deterministic. */
function newestFirst(a: OpenLinkForCapacity, b: OpenLinkForCapacity): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Which open links the daily job deactivates. An invoice that is no longer open loses every open link;
 * otherwise links (`PENDING` or `ACTIVE`) older than 24 hours go first, then the newest remaining links until their sum
 * plus the reserved term fits the open balance. Completed and settled links are never touched.
 */
export function linksToDeactivate(
  openBalance: string,
  openLinks: readonly OpenLinkForCapacity[],
  reserved: string,
  context: { readonly invoiceOpen: boolean; readonly now: Date },
): LinkDeactivation[] {
  assertDecimal(openBalance, 'openBalance');
  assertDecimal(reserved, 'reserved');
  const open = openLinks.filter((link) => isOpenLinkStatus(link.status)).sort(newestFirst);
  if (!context.invoiceOpen) {
    return open.map((link) => ({ linkId: link.id, reason: 'INVOICE_NOT_OPEN' }));
  }
  const cutoff = context.now.getTime() - PENDING_LINK_MAX_AGE_MS;
  const expired = open.filter((link) => link.createdAt.getTime() < cutoff);
  const expiredIds = new Set(expired.map((link) => link.id));
  const out: LinkDeactivation[] = expired.map((link) => ({
    linkId: link.id,
    reason: link.status === 'PENDING' ? 'PENDING_EXPIRED' : 'LINK_EXPIRED',
  }));

  const budget = floorAtZero(subMoney(openBalance, reserved));
  let sum = sumMoney(open.filter((link) => !expiredIds.has(link.id)).map((link) => link.amount));
  for (const link of open) {
    if (expiredIds.has(link.id)) continue;
    if (compareMoney(sum, budget) <= 0) break;
    out.push({ linkId: link.id, reason: 'BALANCE_SHRUNK' });
    sum = subMoney(sum, link.amount);
  }
  return out;
}
