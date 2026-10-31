import type { DateOnly } from '../../../../shared/domain/business-date';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { PaymentStatus } from '../../../../shared/domain/enums';
import type { SortSpec } from '../../../../shared/domain/list-query';
import type { MoneyString } from '../../../../shared/domain/money';
import type { Paginated } from '../../../../shared/domain/pagination';

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

/** One `Payment` row as the use cases write it: money as decimal strings, dates as `YYYY-MM-DD`. */
export interface PaymentRecord {
  readonly id: string;
  readonly code: string;
  readonly clientId: string;
  readonly date: DateOnly;
  readonly accountId: string;
  readonly methodId: string;
  readonly currency: string;
  readonly amount: MoneyString;
  readonly igtfAmount: MoneyString;
  readonly feeAmount: MoneyString;
  /** `amount − fee`: what enters the account (§9.6). */
  readonly netCredited: MoneyString;
  /** `amount − igtf`: what can be applied to invoices (§9.6). */
  readonly allocatable: MoneyString;
  /** Cached `allocatable − Σ live allocations` (C17). */
  readonly unallocated: MoneyString;
  readonly usdRate: MoneyString;
  /** USD snapshot taken at write time and never recomputed (§9.2, C16). */
  readonly amountUsd: MoneyString;
  readonly reference: string | null;
  readonly status: PaymentStatus;
  readonly receiptFileId: string | null;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdById: string | null;
  readonly updatedById: string | null;
}

/** One `PaymentAllocation` row; `deletedAt` is set when the allocation was removed (soft delete). */
export interface PaymentAllocationRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly amountPaymentCurrency: MoneyString;
  readonly amountInvoiceCurrency: MoneyString;
  /** USD snapshot at the payment rate, taken once (§9.5, C16). */
  readonly amountUsd: MoneyString;
  readonly createdAt: string;
  readonly createdById: string | null;
  readonly deletedAt: string | null;
}

export interface PaymentMethodRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameEn: string | null;
}

export interface PaymentAllocationView {
  readonly id: string;
  readonly paymentId: string;
  readonly invoice: EntityRef;
  readonly invoiceCurrency: string;
  readonly amountPaymentCurrency: MoneyString;
  readonly amountInvoiceCurrency: MoneyString;
  readonly amountUsd: MoneyString;
  readonly createdAt: string;
}

/** The payment with the labels of what it points at and its live allocations, for the detail. */
export interface PaymentView extends PaymentRecord {
  readonly client: EntityRef;
  readonly method: PaymentMethodRef;
  readonly account: EntityRef;
  /** `Σ` live allocations in the payment currency. */
  readonly allocated: MoneyString;
  readonly allocations: readonly PaymentAllocationView[];
}

export interface PaymentListRowView {
  readonly id: string;
  readonly code: string;
  readonly date: DateOnly;
  readonly client: EntityRef;
  readonly method: PaymentMethodRef;
  readonly account: EntityRef;
  readonly currency: string;
  readonly amount: MoneyString;
  readonly amountUsd: MoneyString;
  readonly allocated: MoneyString;
  readonly unallocated: MoneyString;
  readonly reference: string | null;
  readonly status: PaymentStatus;
}

export interface PaymentFilter {
  readonly q?: string;
  readonly status?: readonly PaymentStatus[];
  readonly clientId?: readonly string[];
  readonly accountId?: readonly string[];
  readonly methodId?: readonly string[];
  readonly currency?: readonly string[];
  readonly tagId?: readonly string[];
  readonly dateFrom?: DateOnly;
  readonly dateTo?: DateOnly;
  /** Only payments with a credit balance left to apply. */
  readonly hasUnallocated?: boolean;
  readonly sort: SortSpec;
  readonly page: number;
  readonly pageSize: number;
}

export interface DuplicateMatchView {
  readonly payment: EntityRef;
  readonly date: DateOnly;
  readonly amount: MoneyString;
  readonly currency: string;
  readonly status: PaymentStatus;
}

export interface DuplicateQuery {
  readonly methodId: string;
  readonly accountId: string;
  /** Trimmed; the comparison ignores case. */
  readonly reference: string;
  readonly excludePaymentId?: string;
}

/** A confirmed payment of a client with a remainder left to apply (HU-13 CA5). */
export interface CreditRowView {
  readonly paymentId: string;
  readonly code: string;
  readonly date: DateOnly;
  readonly currency: string;
  readonly unallocated: MoneyString;
  readonly usdRate: MoneyString;
}

export interface PaymentLabel {
  readonly id: string;
  readonly code: string;
  readonly clientId: string;
}

/**
 * Access to the `Payment` and `PaymentAllocation` tables. Reads and writes run in the caller's unit of work,
 * which holds the row locks of the global lock order; the adapter takes none. Payments are never archived
 * (Q-BE3-4): they end as `ANULADO`. Allocations are soft-deleted, never removed (contract choice 3).
 */
export interface PaymentRepository {
  findById(id: string): Promise<PaymentRecord | null>;
  insert(record: PaymentRecord): Promise<void>;
  update(record: PaymentRecord): Promise<void>;
  /** Live (not deleted) allocations of the payment, oldest first. */
  liveAllocations(paymentId: string): Promise<PaymentAllocationRecord[]>;
  /** The allocation by id, deleted or not. */
  findAllocation(id: string): Promise<PaymentAllocationRecord | null>;
  /**
   * Throws `CONFLICT` (`allocation_unique_active`) when the payment already has a live allocation to the invoice.
   */
  insertAllocation(record: PaymentAllocationRecord): Promise<void>;
  /** Marks the allocations deleted at `deletedAt` (ISO 8601 UTC). */
  softDeleteAllocations(ids: readonly string[], deletedAt: string): Promise<void>;
  view(id: string): Promise<PaymentView | null>;
  list(filter: PaymentFilter): Promise<Paginated<PaymentListRowView>>;
  /** Non-voided payments with the same method, account and reference (case ignored). */
  duplicates(query: DuplicateQuery): Promise<DuplicateMatchView[]>;
  /** Confirmed payments of the client with an unallocated remainder, oldest first. */
  creditRows(clientId: string): Promise<CreditRowView[]>;
  labels(ids: readonly string[]): Promise<Map<string, PaymentLabel>>;
  /** True when a payment carries the file as its receipt (the download claim of C23). */
  hasReceiptFile(fileId: string): Promise<boolean>;
}
