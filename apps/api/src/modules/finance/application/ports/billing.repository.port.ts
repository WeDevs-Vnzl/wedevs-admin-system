import type { DateOnly } from '../../../../shared/domain/business-date';
import type {
  BillingModel,
  Frequency,
  InstallmentKind,
  InstallmentStatus,
  InvoiceStatus,
  RecurringStatus,
} from '../../../../shared/domain/enums';
import type { MoneyString } from '../../../../shared/domain/money';

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY');

/** The billing plan of a project, with its D1 snapshot (`contractedUsd`, `usdRate`; C16). */
export interface BillingPlanRecord {
  readonly id: string;
  readonly projectId: string;
  readonly model: BillingModel;
  readonly currency: string;
  readonly contractAmount: MoneyString | null;
  readonly contractedUsd: MoneyString | null;
  readonly usdRate: MoneyString | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * An installment with its derived read fields: `invoicedAmount` is the sum of the net amount of the live
 * invoice lines that reference it and `locked` is true while a live (not voided, not archived) invoice does.
 */
export interface InstallmentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly billingPlanId: string | null;
  readonly recurringChargeId: string | null;
  readonly kind: InstallmentKind;
  readonly label: string;
  readonly amount: MoneyString;
  readonly currency: string;
  readonly percentage: MoneyString | null;
  readonly dueDate: DateOnly | null;
  readonly trigger: string | null;
  readonly periodStart: DateOnly | null;
  readonly periodEnd: DateOnly | null;
  readonly order: number;
  readonly status: InstallmentStatus;
  readonly cancelledAt: string | null;
  readonly invoicedAmount: MoneyString;
  readonly locked: boolean;
}

export interface RecurringChargeRecord {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly amount: MoneyString;
  readonly currency: string;
  readonly frequency: Frequency;
  readonly startDate: DateOnly;
  readonly endDate: DateOnly | null;
  readonly billingDay: number;
  readonly leadDays: number;
  readonly status: RecurringStatus;
  readonly lastGeneratedPeriodStart: DateOnly | null;
  readonly resumedOn: DateOnly | null;
  readonly usdRate: MoneyString;
  readonly monthlyAmountUsd: MoneyString;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type NewBillingPlan = Omit<BillingPlanRecord, 'createdAt' | 'updatedAt'>;
export type NewInstallment = Omit<
  InstallmentRecord,
  'status' | 'cancelledAt' | 'invoicedAmount' | 'locked'
>;
export type NewRecurringCharge = Omit<RecurringChargeRecord, 'createdAt' | 'updatedAt'>;

/** Fields an installment edit may change; `undefined` keeps the stored value. */
export interface InstallmentPatch {
  readonly label?: string;
  readonly amount?: MoneyString;
  readonly currency?: string;
  readonly percentage?: MoneyString | null;
  readonly dueDate?: DateOnly | null;
  readonly trigger?: string | null;
  readonly order?: number;
}

export interface RecurringChargePatch {
  readonly label?: string;
  readonly amount?: MoneyString;
  readonly currency?: string;
  readonly frequency?: Frequency;
  readonly startDate?: DateOnly;
  readonly endDate?: DateOnly | null;
  readonly billingDay?: number;
  readonly leadDays?: number;
  readonly status?: RecurringStatus;
  readonly lastGeneratedPeriodStart?: DateOnly | null;
  readonly resumedOn?: DateOnly | null;
  readonly usdRate?: MoneyString;
  readonly monthlyAmountUsd?: MoneyString;
}

/** What `computeInstallmentStatus` needs: the invoices that reference an installment. */
export interface InstallmentInvoiceState {
  readonly id: string;
  readonly status: InstallmentStatus;
  readonly cancelled: boolean;
  /** Live (non-archived) invoices with a line that references the installment, every status. */
  readonly invoices: readonly {
    readonly status: InvoiceStatus;
    readonly paidAmount: MoneyString;
  }[];
}

/** The row ids a project's billing owns, to take their locks in one call (global lock order). */
export interface ProjectBillingIds {
  readonly billingPlanIds: readonly string[];
  readonly installmentIds: readonly string[];
  readonly recurringChargeIds: readonly string[];
}

/**
 * Persistence of the billing slice (plans, installments, recurring charges) as application models.
 * Money travels as decimal strings, dates as `YYYY-MM-DD`. Writes are valid only inside
 * `UnitOfWorkPort.run`, after the caller took its row locks; reads work inside or outside one.
 */
export interface BillingRepository {
  findPlan(projectId: string): Promise<BillingPlanRecord | null>;
  /** Inserts the plan, or updates the stored one of the same id. */
  savePlan(plan: NewBillingPlan, at: Date): Promise<BillingPlanRecord>;

  /** Every installment of a project (cancelled ones included), by `order` then `id`. */
  listInstallments(projectId: string): Promise<InstallmentRecord[]>;
  findInstallment(id: string): Promise<InstallmentRecord | null>;
  /** Highest `order` of the project's installments, or -1 when there are none. */
  maxInstallmentOrder(projectId: string): Promise<number>;
  insertInstallments(rows: readonly NewInstallment[]): Promise<void>;
  /**
   * Inserts generated recurring installments and returns the `periodStart` of the ones actually inserted:
   * a `(recurringChargeId, periodStart)` that already exists is skipped, never an error.
   */
  insertGeneratedInstallments(rows: readonly NewInstallment[]): Promise<DateOnly[]>;
  updateInstallment(id: string, patch: InstallmentPatch, at: Date): Promise<void>;
  /** Marks installments cancelled at `at` and sets their status to `CANCELADA`. */
  cancelInstallments(ids: readonly string[], at: Date): Promise<void>;
  installmentInvoiceStates(ids: readonly string[]): Promise<InstallmentInvoiceState[]>;
  setInstallmentStatus(id: string, status: InstallmentStatus): Promise<void>;
  /** Periods that already exist for a charge, ascending. */
  periodStartsOf(recurringChargeId: string): Promise<DateOnly[]>;

  listCharges(projectId: string): Promise<RecurringChargeRecord[]>;
  findCharge(id: string): Promise<RecurringChargeRecord | null>;
  insertCharge(row: NewRecurringCharge, at: Date): Promise<void>;
  updateCharge(id: string, patch: RecurringChargePatch, at: Date): Promise<void>;
  /** Ids of the charges the daily step visits (status `ACTIVO`), ascending. */
  activeChargeIds(): Promise<string[]>;

  /** Open installment, live recurring charge or issued (non-draft, non-voided, live) invoice of the project. */
  hasActiveBilling(projectId: string): Promise<boolean>;
  hasActiveCharge(projectId: string): Promise<boolean>;
  /** Ids of the billing rows of a project, for lock sets. */
  billingIdsOf(projectId: string): Promise<ProjectBillingIds>;
}
