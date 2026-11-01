import { daysBetween, isBusinessDay, type DateOnly } from '../../../shared/domain/business-date';
import { compareMoney, type MoneyString } from '../../../shared/domain/money';

/**
 * The nine alert rules of PRD §7.9 as pure functions over date and amount inputs. "Today" is the Caracas
 * business day, passed in; every date rule is a whole-calendar-day comparison. `days` is positive until the
 * date and negative since it. A rule returns `null` when the record does not alert.
 *
 *   invoice due soon     0 <= d <= 7 (day 8 is out)      installment to invoice   d <= 7 (past included)
 *   document expiring    0 <= d <= alertDaysBefore       recurring expense        d <= 5 (past included)
 *   payment to verify    age > 2 days (3 is in)          unallocated credit       age > 15 days (16 is in)
 *
 * Payment age is `daysBetween(payment.date, today)`, never `createdAt`; a future-dated payment is out.
 */

export const INVOICE_DUE_SOON_DAYS = 7;
export const INSTALLMENT_DUE_DAYS = 7;
export const RECURRING_EXPENSE_DUE_DAYS = 5;
export const PAYMENT_VERIFY_AFTER_DAYS = 2;
export const UNALLOCATED_AFTER_DAYS = 15;
export const DEFAULT_ALERT_DAYS_BEFORE = 30;

export type AlertHit = { date: DateOnly | null; days: number | null };

const hit = (date: DateOnly, days: number): AlertHit => ({ date, days });

export function invoiceOverdueAlert(
  invoice: { archived: boolean; isDraft: boolean; status: string; dueDate: DateOnly },
  today: DateOnly,
): AlertHit | null {
  if (invoice.archived || invoice.isDraft || invoice.status !== 'VENCIDA') return null;
  return hit(invoice.dueDate, daysBetween(today, invoice.dueDate));
}

export function invoiceDueSoonAlert(
  invoice: {
    archived: boolean;
    isDraft: boolean;
    status: string;
    dueDate: DateOnly;
    balance: MoneyString;
  },
  today: DateOnly,
): AlertHit | null {
  if (invoice.archived || invoice.isDraft) return null;
  if (invoice.status !== 'EMITIDA' && invoice.status !== 'PARCIAL') return null;
  const days = daysBetween(today, invoice.dueDate);
  if (days < 0 || days > INVOICE_DUE_SOON_DAYS) return null;
  if (compareMoney(invoice.balance, '0') <= 0) return null;
  return hit(invoice.dueDate, days);
}

export function installmentToInvoiceAlert(
  installment: { status: string; dueDate: DateOnly | null },
  today: DateOnly,
): AlertHit | null {
  if (installment.status !== 'PENDIENTE' || installment.dueDate === null) return null;
  const days = daysBetween(today, installment.dueDate);
  return days > INSTALLMENT_DUE_DAYS ? null : hit(installment.dueDate, days);
}

export function documentExpiringAlert(
  document: {
    archived: boolean;
    status: string;
    expiresAt: DateOnly | null;
    alertDaysBefore: number | null;
  },
  today: DateOnly,
): AlertHit | null {
  if (document.archived || document.status === 'VENCIDO' || document.status === 'ANULADO') {
    return null;
  }
  if (document.expiresAt === null) return null;
  const days = daysBetween(today, document.expiresAt);
  const window = document.alertDaysBefore ?? DEFAULT_ALERT_DAYS_BEFORE;
  return days < 0 || days > window ? null : hit(document.expiresAt, days);
}

export function documentExpiredAlert(
  document: { archived: boolean; status: string; expiresAt: DateOnly | null },
  today: DateOnly,
): AlertHit | null {
  if (document.archived || document.status !== 'VENCIDO') return null;
  if (document.expiresAt === null) return { date: null, days: null };
  return hit(document.expiresAt, daysBetween(today, document.expiresAt));
}

export function recurringExpensePendingAlert(
  expense: { recurring: boolean; status: string; dueDate: DateOnly | null },
  today: DateOnly,
): AlertHit | null {
  if (!expense.recurring || expense.status !== 'PENDIENTE' || expense.dueDate === null) {
    return null;
  }
  const days = daysBetween(today, expense.dueDate);
  return days > RECURRING_EXPENSE_DUE_DAYS ? null : hit(expense.dueDate, days);
}

export function paymentPendingVerificationAlert(
  payment: { status: string; date: DateOnly },
  today: DateOnly,
): AlertHit | null {
  if (payment.status !== 'PENDIENTE_VERIFICACION') return null;
  const age = daysBetween(payment.date, today);
  return age > PAYMENT_VERIFY_AFTER_DAYS ? hit(payment.date, -age) : null;
}

export function unallocatedCreditAlert(
  payment: { status: string; date: DateOnly; unallocated: MoneyString },
  today: DateOnly,
): AlertHit | null {
  if (payment.status !== 'CONFIRMADO' || compareMoney(payment.unallocated, '0') <= 0) return null;
  const age = daysBetween(payment.date, today);
  return age > UNALLOCATED_AFTER_DAYS ? hit(payment.date, -age) : null;
}

/** A business day with no VES rate dated today. The subject builds the alert key. */
export function missingRateAlert(
  input: { hasRateToday: boolean },
  today: DateOnly,
): { date: DateOnly; days: 0; subject: string } | null {
  if (input.hasRateToday || !isBusinessDay(today)) return null;
  return { date: today, days: 0, subject: `VES:${today}` };
}
