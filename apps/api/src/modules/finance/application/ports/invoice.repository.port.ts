import type { DateOnly } from '../../../../shared/domain/business-date';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type {
  FileStatus,
  InstallmentKind,
  InvoiceStatus,
  PaymentStatus,
} from '../../../../shared/domain/enums';
import type { SortSpec } from '../../../../shared/domain/list-query';
import type { ArchivedMode } from '../../../../shared/domain/list-query';
import type { MoneyString } from '../../../../shared/domain/money';
import type { Paginated } from '../../../../shared/domain/pagination';

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');

/** One line as stored: derived `amount` and `netAmount` included (C17). */
export interface InvoiceLineRecord {
  readonly id: string;
  readonly order: number;
  readonly description: string;
  readonly projectId: string | null;
  readonly installmentId: string | null;
  readonly quantity: MoneyString;
  readonly unitPrice: MoneyString;
  readonly amount: MoneyString;
  readonly discount: MoneyString;
  readonly netAmount: MoneyString;
  /** `null` is exempt; `"0"` is taxable at 0 %. */
  readonly ivaRate: MoneyString | null;
}

/** `InvoiceTaxLine` stores `ivaAmount` only: the adjustment is derived from it (Q-BE3 choice 7). */
export interface InvoiceTaxLineRecord {
  readonly ivaRate: MoneyString;
  readonly taxBase: MoneyString;
  readonly ivaAmount: MoneyString;
}

/** One `Invoice` aggregate as the use cases write it: money as decimal strings, dates as `YYYY-MM-DD`. */
export interface InvoiceRecord {
  readonly id: string;
  readonly code: string;
  readonly clientId: string;
  readonly invoiceNumber: string;
  readonly controlNumber: string | null;
  readonly issueDate: DateOnly;
  readonly dueDate: DateOnly;
  readonly currency: string;
  readonly usdRate: MoneyString;
  readonly bcvRate: MoneyString | null;
  readonly subtotal: MoneyString;
  readonly discount: MoneyString;
  readonly exemptAmount: MoneyString;
  readonly taxBase: MoneyString;
  readonly ivaAmount: MoneyString;
  readonly total: MoneyString;
  readonly ivaWithheld: MoneyString;
  readonly islrWithheld: MoneyString;
  readonly otherWithheld: MoneyString;
  readonly otherWithheldNote: string | null;
  readonly receivable: MoneyString;
  /** USD snapshots taken at write time and never recomputed (§9.2, C16). */
  readonly totalUsd: MoneyString;
  readonly receivableUsd: MoneyString;
  readonly paidAmount: MoneyString;
  readonly balance: MoneyString;
  readonly isDraft: boolean;
  readonly status: InvoiceStatus;
  /** ISO 8601 UTC. */
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly fileId: string | null;
  readonly lines: readonly InvoiceLineRecord[];
  readonly taxLines: readonly InvoiceTaxLineRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdById: string | null;
  readonly updatedById: string | null;
  /** ISO 8601 UTC; set while the invoice sits in the trash. */
  readonly archivedAt: string | null;
  readonly archivedById: string | null;
}

/** A live allocation of a payment to the invoice, as the status and the integrity locks read it. */
export interface InvoiceAllocationState {
  readonly paymentId: string;
  readonly amountInvoiceCurrency: MoneyString;
  readonly paymentStatus: PaymentStatus;
}

/** A billing installment as an invoice line sees it. */
export interface InstallmentRef {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly currency: string;
  readonly amount: MoneyString;
  readonly cancelled: boolean;
}

export interface InvoiceFileView {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: FileStatus;
  readonly uploadedById: string;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
}

export interface InvoiceAllocationRow {
  readonly id: string;
  readonly payment: EntityRef;
  readonly paymentDate: DateOnly;
  readonly paymentCurrency: string;
  readonly amountPaymentCurrency: MoneyString;
  readonly amountInvoiceCurrency: MoneyString;
  readonly amountUsd: MoneyString;
}

export interface InvoiceLineView extends InvoiceLineRecord {
  readonly project: EntityRef | null;
  readonly installment: EntityRef | null;
}

/** The invoice with the labels of what it points at, for the detail. */
export interface InvoiceView extends Omit<InvoiceRecord, 'lines'> {
  readonly client: EntityRef;
  readonly lines: readonly InvoiceLineView[];
  readonly file: InvoiceFileView | null;
  readonly allocations: readonly InvoiceAllocationRow[];
}

export interface InvoiceListRowView {
  readonly id: string;
  readonly code: string;
  readonly invoiceNumber: string;
  readonly client: EntityRef;
  readonly projects: readonly EntityRef[];
  readonly issueDate: DateOnly;
  readonly dueDate: DateOnly;
  readonly currency: string;
  readonly total: MoneyString;
  readonly balance: MoneyString;
  readonly totalUsd: MoneyString;
  readonly balanceUsd: MoneyString;
  readonly status: InvoiceStatus;
  readonly paidAmount: MoneyString;
  readonly archivedAt: string | null;
}

export interface InvoiceFilter {
  readonly q?: string;
  readonly status?: readonly InvoiceStatus[];
  readonly clientId?: readonly string[];
  readonly projectId?: readonly string[];
  readonly currency?: readonly string[];
  readonly tagId?: readonly string[];
  readonly dateFrom?: DateOnly;
  readonly dateTo?: DateOnly;
  readonly archived: ArchivedMode;
  readonly sort: SortSpec;
  readonly page: number;
  readonly pageSize: number;
}

/** A pending installment the billing wizard offers. */
export interface BillableInstallmentView {
  readonly installment: EntityRef;
  readonly project: EntityRef;
  readonly kind: InstallmentKind;
  readonly label: string;
  readonly currency: string;
  readonly amount: MoneyString;
  readonly invoicedAmount: MoneyString;
  readonly dueDate: DateOnly | null;
}

/** An open invoice of a client, as the payment form lists it. */
export interface OpenInvoiceView {
  readonly id: string;
  readonly code: string;
  readonly invoiceNumber: string;
  readonly issueDate: DateOnly;
  readonly dueDate: DateOnly;
  readonly currency: string;
  readonly usdRate: MoneyString;
  readonly receivable: MoneyString;
  readonly balance: MoneyString;
  readonly status: InvoiceStatus;
}

export interface InvoiceLabel {
  readonly id: string;
  readonly code: string;
  readonly invoiceNumber: string;
  readonly clientId: string;
  readonly archived: boolean;
}

/**
 * Access to the `Invoice`, `InvoiceLine` and `InvoiceTaxLine` tables and the finance rows an invoice reads
 * (installments, allocations). Reads and writes run in the caller's unit of work, which holds the row locks of
 * the global lock order; the adapter takes none. Archived invoices are returned flagged, never filtered, by the
 * by-id reads; lists exclude them unless `archived` says otherwise.
 */
export interface InvoiceRepository {
  findById(id: string): Promise<InvoiceRecord | null>;
  /** Writes the header, lines and tax lines. Throws `CONFLICT` (`invoiceNumber`) when the number is taken. */
  insert(record: InvoiceRecord): Promise<void>;
  /** Rewrites the header and replaces the lines and tax lines. Same `CONFLICT` on a taken number. */
  update(record: InvoiceRecord): Promise<void>;
  /** The non-archived invoice holding the number (trimmed, case ignored), other than `exceptId`. */
  numberHolder(invoiceNumber: string, exceptId: string | null): Promise<InvoiceLabel | null>;
  /** Live allocations of the invoice whose payment is not voided (HU-12 CA5). */
  liveAllocations(invoiceId: string): Promise<InvoiceAllocationState[]>;
  installments(ids: readonly string[]): Promise<InstallmentRef[]>;
  /** What live invoices (not voided, not archived; drafts count) bill of each installment, except `exceptInvoiceId`. */
  billedAmounts(
    installmentIds: readonly string[],
    exceptInvoiceId: string | null,
  ): Promise<Map<string, MoneyString>>;
  view(id: string): Promise<InvoiceView | null>;
  list(filter: InvoiceFilter): Promise<Paginated<InvoiceListRowView>>;
  /** `PENDIENTE` installments of the projects, ordered by `order`. */
  billableInstallments(projectIds: readonly string[]): Promise<BillableInstallmentView[]>;
  /** Non-archived `EMITIDA`, `PARCIAL` and `VENCIDA` invoices of the client with a balance. */
  openInvoices(clientId: string): Promise<OpenInvoiceView[]>;
  /** Non-draft `EMITIDA` and `PARCIAL` invoices, archived or not, whose due date is before `today`. */
  overdueIds(today: DateOnly): Promise<string[]>;
  labels(ids: readonly string[]): Promise<Map<string, InvoiceLabel>>;
  /** True when an invoice, archived or not, carries the file (the download claim of C23). */
  hasFile(fileId: string): Promise<boolean>;
}
