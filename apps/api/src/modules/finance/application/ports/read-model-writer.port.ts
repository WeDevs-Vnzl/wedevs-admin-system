import type { DateOnly } from '../../../../shared/domain/business-date';
import type { InstallmentStatus, InvoiceStatus } from '../../../../shared/domain/enums';
import type { MoneyString } from '../../../../shared/domain/money';
import type { FinanceFactKind, FinanceFactSource } from '../../domain/finance-fact';

export const READ_MODEL_WRITER = Symbol('READ_MODEL_WRITER');

/** One `FinanceFact` row (data-rules Δ5) before it gets an id. */
export type FactRow = {
  kind: FinanceFactKind;
  date: DateOnly;
  amountUsd: MoneyString;
  clientId?: string | null;
  projectId?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  methodId?: string | null;
  invoiceId?: string | null;
  ivaRate?: MoneyString | null;
  dueDate?: DateOnly | null;
};

/** The money columns of `ClientMetrics`; `projectCount` and `lastActivityAt` are not this port's (DT-111). */
export type ClientMoneyColumns = {
  invoicedUsd: MoneyString;
  collectedUsd: MoneyString;
  receivableUsd: MoneyString;
  overdueUsd: MoneyString;
  creditUsd: MoneyString;
};

export type ProjectMoneyColumns = {
  contractedUsd: MoneyString;
  invoicedUsd: MoneyString;
  collectedUsd: MoneyString;
  toInvoiceUsd: MoneyString;
  receivableUsd: MoneyString;
  expensesUsd: MoneyString;
  marginUsd: MoneyString;
  monthlyRecurringUsd: MoneyString;
};

export type InvoiceCacheWrite = {
  lines: { id: string; amount: MoneyString; netAmount: MoneyString }[];
  subtotal: MoneyString;
  discount: MoneyString;
  exemptAmount: MoneyString;
  taxBase: MoneyString;
  ivaAmount: MoneyString;
  total: MoneyString;
  receivable: MoneyString;
  totalUsd: MoneyString;
  receivableUsd: MoneyString;
  paidAmount: MoneyString;
  balance: MoneyString;
  status: InvoiceStatus;
  /** Replaces the stored tax lines. */
  taxLines: { ivaRate: MoneyString; taxBase: MoneyString; ivaAmount: MoneyString }[];
};

/**
 * Write side of the finance read models and caches (data-rules §3b, §8). Valid only inside
 * `UnitOfWorkPort.run`. The `lock*` methods take the metrics rows in the documented order, ascending,
 * and are idempotent inside one transaction.
 */
export interface ReadModelWriterPort {
  /** Deletes the facts of `(sourceType, sourceId)`, then inserts `facts`. */
  replaceFacts(
    sourceType: FinanceFactSource,
    sourceId: string,
    facts: readonly FactRow[],
  ): Promise<void>;
  /** Deletes every fact (`RecomputeAll` rebuilds them all). */
  clearFacts(): Promise<void>;

  /**
   * Makes sure the `ClientMetrics` row of each existing client exists and locks them `FOR UPDATE`,
   * ascending by id. Ids that match no client are skipped.
   */
  lockClientMetrics(clientIds: readonly string[]): Promise<void>;
  /** Same for `ProjectMetrics`. */
  lockProjectMetrics(projectIds: readonly string[]): Promise<void>;
  /** Upserts the money columns only; never names `projectCount` or `lastActivityAt`. */
  writeClientMetrics(clientId: string, columns: ClientMoneyColumns): Promise<void>;
  writeProjectMetrics(projectId: string, columns: ProjectMoneyColumns): Promise<void>;
  writeAccountBalance(accountId: string, balance: MoneyString, at: Date): Promise<void>;

  writeInvoiceCache(invoiceId: string, cache: InvoiceCacheWrite): Promise<void>;
  writePaymentCache(
    paymentId: string,
    cache: { allocatable: MoneyString; netCredited: MoneyString; unallocated: MoneyString },
  ): Promise<void>;
  writeInstallmentStatus(installmentId: string, status: InstallmentStatus): Promise<void>;
  writeRecurringChargeMonthlyUsd(id: string, monthlyAmountUsd: MoneyString): Promise<void>;
  writeRecurringExpenseMonthlyUsd(id: string, monthlyAmountUsd: MoneyString): Promise<void>;
}
