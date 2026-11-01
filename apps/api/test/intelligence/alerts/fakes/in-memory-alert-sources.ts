import type {
  AlertSourcesReadPort,
  DocumentAlertRow,
  ExpenseAlertRow,
  InstallmentAlertRow,
  InvoiceAlertRow,
  PaymentAlertRow,
} from '../../../../src/modules/intelligence/application/ports/alert-sources-read.port';
import type { DateOnly } from '../../../../src/shared/domain/business-date';

/** Keeps the narrowing of the real adapter (status and date window), so a boundary test covers both. */
export class InMemoryAlertSources implements AlertSourcesReadPort {
  invoices: InvoiceAlertRow[] = [];
  installments: InstallmentAlertRow[] = [];
  documents: DocumentAlertRow[] = [];
  expenses: ExpenseAlertRow[] = [];
  payments: PaymentAlertRow[] = [];
  vesRateDays = new Set<DateOnly>();

  overdueInvoices() {
    return Promise.resolve(
      this.invoices.filter((r) => r.status === 'VENCIDA' && !r.isDraft && !r.archived),
    );
  }

  dueSoonInvoices(range: { from: DateOnly; to: DateOnly }) {
    return Promise.resolve(
      this.invoices.filter(
        (r) =>
          (r.status === 'EMITIDA' || r.status === 'PARCIAL') &&
          !r.isDraft &&
          !r.archived &&
          r.dueDate >= range.from &&
          r.dueDate <= range.to,
      ),
    );
  }

  pendingInstallments(upTo: DateOnly) {
    return Promise.resolve(
      this.installments.filter(
        (r) => r.status === 'PENDIENTE' && r.dueDate !== null && r.dueDate <= upTo,
      ),
    );
  }

  expiringDocuments(from: DateOnly) {
    return Promise.resolve(
      this.documents.filter(
        (r) =>
          r.status !== 'ANULADO' &&
          r.status !== 'VENCIDO' &&
          !r.archived &&
          r.expiresAt !== null &&
          r.expiresAt >= from,
      ),
    );
  }

  expiredDocuments() {
    return Promise.resolve(this.documents.filter((r) => r.status === 'VENCIDO' && !r.archived));
  }

  pendingRecurringExpenses(upTo: DateOnly) {
    return Promise.resolve(
      this.expenses.filter(
        (r) => r.recurring && r.status === 'PENDIENTE' && r.dueDate !== null && r.dueDate <= upTo,
      ),
    );
  }

  pendingVerificationPayments(upTo: DateOnly) {
    return Promise.resolve(
      this.payments.filter((r) => r.status === 'PENDIENTE_VERIFICACION' && r.date <= upTo),
    );
  }

  unallocatedPayments(upTo: DateOnly) {
    return Promise.resolve(
      this.payments.filter(
        (r) => r.status === 'CONFIRMADO' && r.unallocated !== '0.00' && r.date <= upTo,
      ),
    );
  }

  hasVesRate(day: DateOnly) {
    return Promise.resolve(this.vesRateDays.has(day));
  }
}
