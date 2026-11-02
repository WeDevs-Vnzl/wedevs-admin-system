import { Injectable } from '@nestjs/common';
import { parseDateOnly, type DateOnly } from '../../../shared/domain/business-date';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  AlertSourcesReadPort,
  DocumentAlertRow,
  ExpenseAlertRow,
  InstallmentAlertRow,
  InvoiceAlertRow,
  PaymentAlertRow,
} from '../application/ports/alert-sources-read.port';

/** `@db.Date` round-trips as 00:00 UTC, so the business date is its ISO prefix (never a zone shift). */
const dateOnly = (value: Date): DateOnly => value.toISOString().slice(0, 10);
/** Every money column is `Decimal(18, 2)`; the string never passes through a JS number (C15). */
const money = (value: Prisma.Decimal): string => value.toFixed(2);
const ref = (type: EntityRef['type'], id: string, code: string, label: string): EntityRef => ({
  type,
  id,
  code,
  label,
});

const INVOICE_SELECT = {
  id: true,
  code: true,
  invoiceNumber: true,
  isDraft: true,
  status: true,
  dueDate: true,
  balance: true,
  currency: true,
  deletedAt: true,
  client: { select: { tradeName: true } },
} satisfies Prisma.InvoiceSelect;
type InvoiceSelected = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;

const PAYMENT_SELECT = {
  id: true,
  code: true,
  status: true,
  date: true,
  amount: true,
  unallocated: true,
  currency: true,
  deletedAt: true,
  client: { select: { tradeName: true } },
} satisfies Prisma.PaymentSelect;
type PaymentSelected = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

const DOCUMENT_SELECT = {
  id: true,
  code: true,
  title: true,
  status: true,
  expiresAt: true,
  alertDaysBefore: true,
  deletedAt: true,
  type: { select: { name: true } },
} satisfies Prisma.DocumentSelect;
type DocumentSelected = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

const toInvoice = (row: InvoiceSelected): InvoiceAlertRow => ({
  id: row.id,
  entity: ref('INVOICE', row.id, row.code, row.invoiceNumber),
  context: row.client.tradeName,
  archived: row.deletedAt !== null,
  isDraft: row.isDraft,
  status: row.status,
  dueDate: dateOnly(row.dueDate),
  balance: money(row.balance),
  currency: row.currency,
});

const toPayment = (row: PaymentSelected): PaymentAlertRow => ({
  id: row.id,
  entity: ref('PAYMENT', row.id, row.code, row.code),
  context: row.client.tradeName,
  archived: row.deletedAt !== null,
  status: row.status,
  date: dateOnly(row.date),
  amount: money(row.amount),
  unallocated: money(row.unallocated),
  currency: row.currency,
});

const toDocument = (row: DocumentSelected): DocumentAlertRow => ({
  id: row.id,
  entity: ref('DOCUMENT', row.id, row.code, row.title),
  context: row.type.name,
  archived: row.deletedAt !== null,
  status: row.status,
  expiresAt: row.expiresAt === null ? null : dateOnly(row.expiresAt),
  alertDaysBefore: row.alertDaysBefore,
});

/**
 * The live candidates of the nine alerts over the partial indexes of data-rules §3b (`inv_open`,
 * `inst_pending`, `doc_expiring`, `exp_recurring_pending`, `pay_status_date`, `pay_unallocated`). Soft-deleted
 * rows are excluded by the client extension (`deletedAt IS NULL`, the predicate of those indexes); the
 * nested client / type / project names are plain joins. Reads only: nothing here writes.
 */
@Injectable()
export class PrismaAlertSourcesRead implements AlertSourcesReadPort {
  constructor(private readonly tx: TransactionHost) {}

  async overdueInvoices(): Promise<InvoiceAlertRow[]> {
    const rows = await this.tx.db.invoice.findMany({
      where: { status: 'VENCIDA', isDraft: false },
      select: INVOICE_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toInvoice);
  }

  async dueSoonInvoices(range: { from: DateOnly; to: DateOnly }): Promise<InvoiceAlertRow[]> {
    const rows = await this.tx.db.invoice.findMany({
      where: {
        status: { in: ['EMITIDA', 'PARCIAL'] },
        isDraft: false,
        dueDate: { gte: parseDateOnly(range.from), lte: parseDateOnly(range.to) },
        balance: { gt: 0 },
      },
      select: INVOICE_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toInvoice);
  }

  async pendingInstallments(upTo: DateOnly): Promise<InstallmentAlertRow[]> {
    const rows = await this.tx.db.billingInstallment.findMany({
      where: {
        status: 'PENDIENTE',
        dueDate: { not: null, lte: parseDateOnly(upTo) },
        project: { deletedAt: null },
      },
      select: {
        id: true,
        label: true,
        amount: true,
        currency: true,
        status: true,
        dueDate: true,
        project: { select: { id: true, code: true, name: true } },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      entity: ref('PROJECT', row.project.id, row.project.code, row.project.name),
      context: row.label,
      archived: false,
      status: row.status,
      dueDate: row.dueDate === null ? null : dateOnly(row.dueDate),
      amount: money(row.amount),
      currency: row.currency,
    }));
  }

  async expiringDocuments(from: DateOnly): Promise<DocumentAlertRow[]> {
    const rows = await this.tx.db.document.findMany({
      where: { status: { notIn: ['ANULADO', 'VENCIDO'] }, expiresAt: { gte: parseDateOnly(from) } },
      select: DOCUMENT_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toDocument);
  }

  async expiredDocuments(): Promise<DocumentAlertRow[]> {
    const rows = await this.tx.db.document.findMany({
      where: { status: 'VENCIDO' },
      select: DOCUMENT_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toDocument);
  }

  async pendingRecurringExpenses(upTo: DateOnly): Promise<ExpenseAlertRow[]> {
    const rows = await this.tx.db.expense.findMany({
      where: {
        status: 'PENDIENTE',
        recurringExpenseId: { not: null },
        dueDate: { not: null, lte: parseDateOnly(upTo) },
      },
      select: {
        id: true,
        code: true,
        description: true,
        vendor: true,
        recurringExpenseId: true,
        status: true,
        dueDate: true,
        amount: true,
        currency: true,
        deletedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      entity: ref('EXPENSE', row.id, row.code, row.description),
      context: row.vendor ?? row.description,
      archived: row.deletedAt !== null,
      recurring: row.recurringExpenseId !== null,
      status: row.status,
      dueDate: row.dueDate === null ? null : dateOnly(row.dueDate),
      amount: money(row.amount),
      currency: row.currency,
    }));
  }

  async pendingVerificationPayments(upTo: DateOnly): Promise<PaymentAlertRow[]> {
    const rows = await this.tx.db.payment.findMany({
      where: { status: 'PENDIENTE_VERIFICACION', date: { lte: parseDateOnly(upTo) } },
      select: PAYMENT_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toPayment);
  }

  async unallocatedPayments(upTo: DateOnly): Promise<PaymentAlertRow[]> {
    const rows = await this.tx.db.payment.findMany({
      where: { status: 'CONFIRMADO', unallocated: { gt: 0 }, date: { lte: parseDateOnly(upTo) } },
      select: PAYMENT_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toPayment);
  }

  async hasVesRate(day: DateOnly): Promise<boolean> {
    const count = await this.tx.db.exchangeRate.count({
      where: { currency: 'VES', date: parseDateOnly(day) },
    });
    return count > 0;
  }
}
