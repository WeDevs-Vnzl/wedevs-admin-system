import type { DateOnly } from '../../../../shared/domain/business-date';
import type {
  BillingModel,
  AccountMovementType,
  ExpenseStatus,
  Frequency,
  InvoiceStatus,
  PaymentStatus,
} from '../../../../shared/domain/enums';
import type { MoneyString } from '../../../../shared/domain/money';
import type { AccountActivity } from '../../domain/accounts';
import type { FactLine } from '../../domain/finance-fact';

export const FINANCE_SOURCES = Symbol('FINANCE_SOURCES');

/**
 * Read side of the finance read models: the source rows a projection recomputes from, as application
 * models (money as decimal strings, dates as `YYYY-MM-DD`). Every method returns `null` for an id that
 * matches no row. Valid inside `UnitOfWorkPort.run`; the callers hold the row locks of the global lock
 * order, so the adapter takes none. Archived (soft-deleted) rows of the projected entity itself are
 * returned flagged, never filtered, so the projector decides; rows nested under another entity are the
 * live ones.
 */
export interface FinanceSourcesPort {
  invoiceFacts(id: string): Promise<InvoiceFactSource | null>;
  paymentFacts(id: string): Promise<PaymentFactSource | null>;
  expenseFacts(id: string): Promise<ExpenseFactSource | null>;
  transferFacts(id: string): Promise<TransferFactSource | null>;
  movementFacts(id: string): Promise<MovementFactSource | null>;
  /** The account and everything that moves its balance (live rows only). */
  accountSource(id: string): Promise<AccountSource | null>;
  clientMetricsSource(clientId: string): Promise<ClientMetricsSource | null>;
  projectMetricsSource(projectId: string): Promise<ProjectMetricsSource | null>;

  // Caches `RecomputeAll` rebuilds (data-rules §8).
  invoiceCache(id: string): Promise<InvoiceCacheSource | null>;
  paymentCache(id: string): Promise<PaymentCacheSource | null>;
  installmentCache(id: string): Promise<InstallmentCacheSource | null>;
  recurringChargeCache(id: string): Promise<RecurringCacheSource | null>;
  recurringExpenseCache(id: string): Promise<RecurringCacheSource | null>;

  /** Every id of every projected or rebuilt entity, archived rows included. */
  allIds(): Promise<FinanceSourceIds>;
}

export type FinanceSourceIds = {
  clients: string[];
  projects: string[];
  recurringCharges: string[];
  recurringExpenses: string[];
  installments: string[];
  invoices: string[];
  payments: string[];
  expenses: string[];
  accounts: string[];
  transfers: string[];
  movements: string[];
};

export type InvoiceFactSource = {
  id: string;
  clientId: string;
  status: InvoiceStatus;
  isDraft: boolean;
  archived: boolean;
  issueDate: DateOnly;
  dueDate: DateOnly;
  usdRate: MoneyString;
  totalUsd: MoneyString;
  ivaWithheld: MoneyString;
  islrWithheld: MoneyString;
  otherWithheld: MoneyString;
  lines: FactLine[];
  taxLines: { ivaRate: MoneyString; ivaAmount: MoneyString }[];
};

export type PaymentFactSource = {
  id: string;
  clientId: string;
  accountId: string;
  methodId: string;
  date: DateOnly;
  status: PaymentStatus;
  archived: boolean;
  usdRate: MoneyString;
  igtfAmount: MoneyString;
  /** Live allocations, each with the lines of its invoice (the split of Q-BE3-7). */
  allocations: { invoiceId: string; amountUsd: MoneyString; invoiceLines: FactLine[] }[];
};

export type ExpenseFactSource = {
  id: string;
  status: ExpenseStatus;
  archived: boolean;
  /** `paidAt` when set, otherwise the expense date. */
  paidDate: DateOnly;
  accountId: string | null;
  categoryId: string;
  projectId: string | null;
  amountUsd: MoneyString;
};

export type TransferFactSource = {
  id: string;
  archived: boolean;
  date: DateOnly;
  fromAccountId: string;
  toAccountId: string;
  amountUsd: MoneyString;
};

export type MovementFactSource = {
  id: string;
  archived: boolean;
  date: DateOnly;
  accountId: string;
  type: AccountMovementType;
  amountUsd: MoneyString;
};

export type AccountSource = { id: string; activity: AccountActivity };

export type ClientMetricsSource = {
  clientId: string;
  /** Live invoices of the client, every status. */
  invoices: {
    status: InvoiceStatus;
    isDraft: boolean;
    totalUsd: MoneyString;
    balance: MoneyString;
    usdRate: MoneyString;
  }[];
  /** Live allocations of live payments of the client. */
  allocations: { amountUsd: MoneyString; paymentStatus: PaymentStatus }[];
  /** Live payments of the client. */
  payments: { status: PaymentStatus; unallocated: MoneyString; usdRate: MoneyString }[];
};

export type ProjectMetricsSource = {
  projectId: string;
  plan: {
    model: BillingModel;
    currency: string;
    contractedUsd: MoneyString | null;
    usdRate: MoneyString | null;
  } | null;
  /** Non-cancelled `AJUSTE` installments in their own currency (signed). */
  adjustments: { amount: MoneyString; currency: string }[];
  /** Lines of live invoices that name the project, with the payment state of their invoice. */
  lines: {
    invoiceStatus: InvoiceStatus;
    invoiceIsDraft: boolean;
    netAmount: MoneyString;
    invoiceUsdRate: MoneyString;
    invoiceReceivable: MoneyString;
    invoicePaid: MoneyString;
  }[];
  /** `monthlyAmountUsd` of the active recurring charges. */
  recurringMonthlyUsd: MoneyString[];
  /** `amountUsd` of the paid, live expenses charged to the project. */
  paidExpensesUsd: MoneyString[];
};

export type InvoiceCacheSource = {
  id: string;
  dueDate: DateOnly;
  usdRate: MoneyString;
  ivaWithheld: MoneyString;
  islrWithheld: MoneyString;
  otherWithheld: MoneyString;
  isDraft: boolean;
  voided: boolean;
  lines: {
    id: string;
    quantity: MoneyString;
    unitPrice: MoneyString;
    discount: MoneyString;
    ivaRate: MoneyString | null;
  }[];
  /** The stored tax lines: their adjustment is `ivaAmount − round(taxBase × rate / 100, 2)`. */
  taxLines: { ivaRate: MoneyString; taxBase: MoneyString; ivaAmount: MoneyString }[];
  /** Live allocations of live payments. */
  allocations: { amountInvoiceCurrency: MoneyString; paymentStatus: PaymentStatus }[];
};

export type PaymentCacheSource = {
  id: string;
  amount: MoneyString;
  igtfAmount: MoneyString;
  feeAmount: MoneyString;
  /** Live allocations in the payment currency. */
  allocated: MoneyString[];
};

export type InstallmentCacheSource = {
  id: string;
  cancelled: boolean;
  /** Live (non-archived) invoices with a line that references the installment. */
  invoices: { status: InvoiceStatus; paidAmount: MoneyString }[];
};

export type RecurringCacheSource = {
  id: string;
  amount: MoneyString;
  frequency: Frequency;
  usdRate: MoneyString;
};
