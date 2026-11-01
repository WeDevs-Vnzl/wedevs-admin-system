import type { DateOnly } from '../../../../shared/domain/business-date';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { MoneyString } from '../../../../shared/domain/money';

export const ALERT_SOURCES_READ = Symbol('ALERT_SOURCES_READ');

/** Common to every candidate: the record's id (the alert key subject) and what the bell shows. */
interface AlertSourceRow {
  /** Id of the source record; the subject of the alert key. */
  readonly id: string;
  /** The record the alert is about (an installment points at its project). */
  readonly entity: EntityRef;
  /** Short context under the title: client name, document type... */
  readonly context: string | null;
  readonly archived: boolean;
}

export interface InvoiceAlertRow extends AlertSourceRow {
  readonly isDraft: boolean;
  readonly status: string;
  readonly dueDate: DateOnly;
  readonly balance: MoneyString;
  readonly currency: string;
}

export interface InstallmentAlertRow extends AlertSourceRow {
  readonly status: string;
  readonly dueDate: DateOnly | null;
  readonly amount: MoneyString;
  readonly currency: string;
}

export interface DocumentAlertRow extends AlertSourceRow {
  readonly status: string;
  readonly expiresAt: DateOnly | null;
  readonly alertDaysBefore: number | null;
}

export interface ExpenseAlertRow extends AlertSourceRow {
  readonly recurring: boolean;
  readonly status: string;
  readonly dueDate: DateOnly | null;
  readonly amount: MoneyString;
  readonly currency: string;
}

export interface PaymentAlertRow extends AlertSourceRow {
  readonly status: string;
  readonly date: DateOnly;
  readonly amount: MoneyString;
  readonly unallocated: MoneyString;
  readonly currency: string;
}

/**
 * Live candidates of the nine alerts (PRD §7.9), narrowed in SQL to the partial indexes of data-rules §3b.
 * The domain rules still decide: a row here is only "could alert". Amounts are decimal strings (C15) and
 * dates are business dates; nothing here reads or writes per-user state.
 */
export interface AlertSourcesReadPort {
  /** `VENCIDA`, not a draft. */
  overdueInvoices(): Promise<InvoiceAlertRow[]>;
  /** `EMITIDA` / `PARCIAL`, not a draft, due from `from` to `to` inclusive. */
  dueSoonInvoices(range: { from: DateOnly; to: DateOnly }): Promise<InvoiceAlertRow[]>;
  /** `PENDIENTE` installments due on or before `upTo`. */
  pendingInstallments(upTo: DateOnly): Promise<InstallmentAlertRow[]>;
  /** Neither `ANULADO` nor `VENCIDO`, expiring on or after `from`. */
  expiringDocuments(from: DateOnly): Promise<DocumentAlertRow[]>;
  /** `VENCIDO`. */
  expiredDocuments(): Promise<DocumentAlertRow[]>;
  /** `PENDIENTE` generated expenses due on or before `upTo`. */
  pendingRecurringExpenses(upTo: DateOnly): Promise<ExpenseAlertRow[]>;
  /** `PENDIENTE_VERIFICACION` payments dated on or before `upTo`. */
  pendingVerificationPayments(upTo: DateOnly): Promise<PaymentAlertRow[]>;
  /** `CONFIRMADO` payments with unallocated credit dated on or before `upTo`. */
  unallocatedPayments(upTo: DateOnly): Promise<PaymentAlertRow[]>;
  /** Whether a VES rate dated `day` exists. */
  hasVesRate(day: DateOnly): Promise<boolean>;
}
