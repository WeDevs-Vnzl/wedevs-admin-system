import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type {
  RowLockSet,
  RowLocksPort,
} from '../../../../../shared/application/ports/row-locks.port';
import type {
  SearchIndexEntry,
  SearchIndexPort,
} from '../../../../../shared/application/ports/search-index.port';
import type { Actor } from '../../../../../shared/application/actor';
import {
  isValidDateOnly,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import type { ActivityAction } from '../../../../../shared/domain/enums';
import { compareMoney, isDecimalString, toDecimal } from '../../../../../shared/domain/money';
import { EXPENSE_ERRORS } from '../../../domain/errors';
import { dueRecurringPeriods, type RecurringSchedule } from '../../../domain/recurring';
import type { FinanceProjector } from '../../finance-projector';
import type {
  ExpenseAccountRef,
  ExpenseReceiptFilesPort,
  ExpenseReferencesPort,
} from '../../ports/expense-references.port';
import type {
  RecurringExpenseRecord,
  RecurringExpenseView,
} from '../../ports/expense-recurring.repository.port';
import type {
  ExpenseRecord,
  ExpenseRepository,
  ExpenseView,
} from '../../ports/expense.repository.port';

/** Message keys of the expense forms (`expenses.validation.*`, FE `EXPENSE_MESSAGES`) and the shared shape ones. */
export const EXPENSE_MESSAGES = {
  accountRequiredForPaid: 'expenses.validation.accountRequiredForPaid',
  accountAmountRequired: 'expenses.validation.accountAmountRequired',
  dueBeforeDate: 'expenses.validation.dueBeforeDate',
  endBeforeStart: 'billing.validation.endBeforeStart',
  billingDayRange: 'billing.validation.billingDayRange',
  leadDaysRange: 'billing.validation.leadDaysRange',
  usdRateMustBeOne: 'catalogs.validation.usdRateMustBeOne',
  unknownCurrency: 'catalogs.rates.errors.unknownCurrency',
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidDate: 'validation.date.invalid',
  invalidMoney: 'validation.money.invalid',
  moneyMustBePositive: 'validation.money.mustBePositive',
  moneyTooManyDecimals: 'validation.money.tooManyDecimals',
  moneyOutOfRange: 'validation.money.outOfRange',
  invalidRate: 'validation.rate.invalid',
  rateMustBePositive: 'validation.rate.mustBePositive',
  rateTooManyDecimals: 'validation.rate.tooManyDecimals',
  rateOutOfRange: 'validation.rate.outOfRange',
  invalidOption: 'validation.invalidOption',
} as const;

export const EXPENSE_SORT_FIELDS = [
  'code',
  'date',
  'dueDate',
  'description',
  'vendor',
  'amount',
  'amountUsd',
  'status',
] as const;
export const RECURRING_EXPENSE_SORT_FIELDS = [
  'name',
  'vendor',
  'amount',
  'frequency',
  'startDate',
  'status',
] as const;

/** Guard on the periods one generation may create; a sane schedule never reaches it. */
export const MAX_PERIODS_PER_RUN = 24;
/** Guard on the periods one walk may pass over (skipped ones included). */
const MAX_PERIODS_WALKED = 600;
/** "Far enough" to list the next period of a schedule whatever today is. */
const NO_LIMIT: DateOnly = '9999-12-31';

export const DEFAULT_RECURRING_EXPENSE_LEAD_DAYS = 5;

// ───────────────────────────── Shape rules (enforced here, never only in the DTO, lesson B2) ─────────────────────────────

export function addError(errors: FieldErrors, path: string, key: string): void {
  errors[path] = [...(errors[path] ?? []), key];
}

export function dateError(errors: FieldErrors, path: string, value: unknown): value is string {
  if (typeof value === 'string' && isValidDateOnly(value)) return true;
  addError(errors, path, EXPENSE_MESSAGES.invalidDate);
  return false;
}

/** A money amount: decimal string, at most 2 decimals, 16 integer digits (`Decimal(18,2)`), strictly positive. */
export function moneyError(errors: FieldErrors, path: string, value: unknown): void {
  if (!isDecimalString(value) || value.startsWith('-')) {
    addError(errors, path, EXPENSE_MESSAGES.invalidMoney);
  } else if (!/^(?:0|[1-9]\d{0,15})(?:\.\d+)?$/.test(value)) {
    addError(errors, path, EXPENSE_MESSAGES.moneyOutOfRange);
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    addError(errors, path, EXPENSE_MESSAGES.moneyTooManyDecimals);
  } else if (toDecimal(value).isZero()) {
    addError(errors, path, EXPENSE_MESSAGES.moneyMustBePositive);
  }
}

/** A rate: decimal string > 0, at most 8 decimals and 12 integer digits (`Decimal(20,8)`). */
export function rateError(errors: FieldErrors, path: string, value: unknown): boolean {
  if (!isDecimalString(value) || value.startsWith('-')) {
    addError(errors, path, EXPENSE_MESSAGES.invalidRate);
  } else if (!/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(value)) {
    addError(errors, path, EXPENSE_MESSAGES.rateOutOfRange);
  } else if (!/^\d+(?:\.\d{1,8})?$/.test(value)) {
    addError(errors, path, EXPENSE_MESSAGES.rateTooManyDecimals);
  } else if (toDecimal(value).isZero()) {
    addError(errors, path, EXPENSE_MESSAGES.rateMustBePositive);
  } else {
    return true;
  }
  return false;
}

/** USD is the reference currency: its rate is exactly 1. */
export function usdRateError(errors: FieldErrors, currency: string, usdRate: string): void {
  if (!rateError(errors, 'usdRate', usdRate)) return;
  if (currency === 'USD' && compareMoney(usdRate, '1') !== 0) {
    addError(errors, 'usdRate', EXPENSE_MESSAGES.usdRateMustBeOne);
  }
}

export function textError(
  errors: FieldErrors,
  path: string,
  value: unknown,
  max: number,
  required: boolean,
): void {
  if (value === undefined || value === null) {
    if (required) addError(errors, path, EXPENSE_MESSAGES.required);
    return;
  }
  if (typeof value !== 'string' || (required && value.trim() === '')) {
    addError(errors, path, EXPENSE_MESSAGES.required);
  } else if (value.trim().length > max) {
    addError(errors, path, EXPENSE_MESSAGES.tooLong);
  }
}

export function throwIfAny(errors: FieldErrors): void {
  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
}

/** `VALIDATION` on one field with one i18n key. */
export function invalid(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ fieldErrors: { [field]: [key] } });
}

/** §9.7: when the account currency differs, the debit in that currency (`accountAmount`) is required. */
export function checkAccountAmount(
  currency: string,
  accountCurrency: string,
  accountAmount: string | null | undefined,
): void {
  if (accountCurrency !== currency && (accountAmount === undefined || accountAmount === null)) {
    throw invalid('accountAmount', EXPENSE_MESSAGES.accountAmountRequired);
  }
}

/** The debit in the account currency is stored only when it differs from the expense currency. */
export function storedAccountAmount(
  currency: string,
  account: ExpenseAccountRef | null,
  accountAmount: string | null | undefined,
): string | null {
  if (account !== null && account.currency === currency) return null;
  return accountAmount ?? null;
}

// ───────────────────────────── Output models ─────────────────────────────

export interface ExpenseOutput extends ExpenseView {
  /** Pending and past its due date. */
  readonly overdue: boolean;
  /** Generated by a recurring expense. */
  readonly recurring: boolean;
}

export interface RecurringExpenseOutput extends RecurringExpenseView {
  /** Next period start still to generate; `null` when finished. */
  readonly nextDueDate: DateOnly | null;
}

export function isOverdue(expense: ExpenseRecord, today: DateOnly): boolean {
  return expense.status === 'PENDIENTE' && expense.dueDate !== null && expense.dueDate < today;
}

export function toExpenseOutput(view: ExpenseView, today: DateOnly): ExpenseOutput {
  return { ...view, overdue: isOverdue(view, today), recurring: view.recurringExpenseId !== null };
}

// ───────────────────────────── Recurring schedule (HU-17, §8.13.2) ─────────────────────────────

export function scheduleOf(
  row: Pick<
    RecurringExpenseRecord,
    'frequency' | 'startDate' | 'endDate' | 'dayOfPeriod' | 'leadDays'
  >,
  status: RecurringSchedule['status'],
): RecurringSchedule {
  return {
    frequency: row.frequency,
    startDate: row.startDate,
    endDate: row.endDate,
    billingDay: row.dayOfPeriod,
    leadDays: row.leadDays,
    status,
  };
}

/**
 * The next period of `row` due by `asOf` that is neither in `taken` nor skipped by the last resume: periods
 * whose generation day fell before `resumedOn` are passed over, so a resumed schedule never back-fills its
 * pause (PRD §8.4.3).
 */
export function nextOpenPeriod(
  row: RecurringExpenseRecord,
  status: RecurringSchedule['status'],
  taken: readonly DateOnly[],
  asOf: DateOnly,
) {
  const skipped: DateOnly[] = [];
  for (let guard = 0; guard < MAX_PERIODS_WALKED; guard += 1) {
    const [due] = dueRecurringPeriods(scheduleOf(row, status), [...taken, ...skipped], asOf);
    if (!due) return null;
    if (row.resumedOn === null || due.generateOn >= row.resumedOn) return due;
    skipped.push(due.periodStart);
  }
  return null;
}

export function nextDueDateOf(
  row: RecurringExpenseRecord,
  taken: readonly DateOnly[],
): DateOnly | null {
  if (row.status === 'FINALIZADO') return null;
  return nextOpenPeriod(row, 'ACTIVO', taken, NO_LIMIT)?.periodStart ?? null;
}

// ───────────────────────────── Search and activity ─────────────────────────────

export function expenseSearchEntry(record: ExpenseRecord): SearchIndexEntry {
  return {
    entityType: 'EXPENSE',
    entityId: record.id,
    code: record.code,
    title: record.description,
    subtitle: record.vendor,
    body: record.vendor,
    status: record.status,
    archived: false,
  };
}

/** Fields the `UPDATE` entry compares. */
export const EXPENSE_ACTIVITY_FIELDS = [
  'date',
  'dueDate',
  'description',
  'vendor',
  'categoryId',
  'accountId',
  'projectId',
  'currency',
  'amount',
  'accountAmount',
  'usdRate',
  'receiptFileId',
] as const;

// ───────────────────────────── Shared mutation steps ─────────────────────────────

const ids = (...values: (string | null | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => typeof value === 'string')),
];

/** The row-lock set of an expense mutation: only the classes it touches, the adapter orders them. */
export function expenseLockSet(parts: {
  projectIds?: (string | null | undefined)[];
  recurringIds?: (string | null | undefined)[];
  expenseIds?: (string | null | undefined)[];
  accountIds?: (string | null | undefined)[];
}): RowLockSet {
  const set: { -readonly [K in keyof RowLockSet]: string[] } = {};
  const project = ids(...(parts.projectIds ?? []));
  const recurring = ids(...(parts.recurringIds ?? []));
  const expense = ids(...(parts.expenseIds ?? []));
  const account = ids(...(parts.accountIds ?? []));
  if (project.length > 0) set.Project = project;
  if (recurring.length > 0) set.RecurringExpense = recurring;
  if (expense.length > 0) set.Expense = expense;
  if (account.length > 0) set.Account = account;
  return set;
}

/**
 * The pieces every expense mutation shares: reference checks, the receipt claim, and the persist →
 * project → search → activity tail of the global write order. Valid only inside the use case's unit of work,
 * after it took its row locks.
 */
export class ExpenseSupport {
  constructor(
    readonly expenses: ExpenseRepository,
    private readonly references: ExpenseReferencesPort,
    private readonly receipts: ExpenseReceiptFilesPort,
    private readonly projector: FinanceProjector,
    private readonly search: SearchIndexPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    readonly locks: RowLocksPort,
  ) {}

  async requireCategory(categoryId: string): Promise<void> {
    if (!(await this.references.activeCategory(categoryId))) {
      throw invalid('categoryId', EXPENSE_ERRORS.categoryUnavailable);
    }
  }

  async requireAccount(accountId: string): Promise<ExpenseAccountRef> {
    const account = await this.references.activeAccount(accountId);
    if (!account) throw invalid('accountId', EXPENSE_ERRORS.accountUnavailable);
    return account;
  }

  async requireProject(projectId: string): Promise<void> {
    if (!(await this.references.liveProject(projectId))) {
      throw invalid('projectId', EXPENSE_ERRORS.projectUnavailable);
    }
  }

  /** Claims the receipt file; an unknown or unusable one is a `VALIDATION` on `receiptFileId`. */
  async reserveReceipt(actor: CurrentUser, fileId: string | null | undefined): Promise<void> {
    if (fileId === null || fileId === undefined) return;
    try {
      await this.receipts.reserve(actor, fileId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw invalid('receiptFileId', EXPENSE_ERRORS.receiptUnavailable);
      }
      throw error;
    }
  }

  async output(id: string): Promise<ExpenseOutput> {
    const view = await this.expenses.view(id);
    if (!view) throw new NotFoundError();
    return toExpenseOutput(view, todayOf(this.clock));
  }

  /**
   * Writes the record, then recomputes what it feeds in the documented order: facts, the account balance,
   * the project metrics (paid expenses only), the search entry and the activity entry. `before` is the
   * stored row an update starts from (`null` for an insert).
   */
  async persist(
    actor: Actor,
    action: ActivityAction,
    before: ExpenseRecord | null,
    after: ExpenseRecord,
    detail: { changes?: Record<string, unknown> | null; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    if (before === null) await this.expenses.insert(after);
    else await this.expenses.update(after);

    await this.projector.projectExpense(after.id);
    const touchesMoney = after.status === 'PAGADO' || before?.status === 'PAGADO';
    if (touchesMoney) {
      for (const accountId of ids(before?.accountId, after.accountId)) {
        await this.projector.projectAccount(accountId);
      }
      await this.projector.projectProjects(ids(before?.projectId, after.projectId));
    }
    await this.search.upsert(expenseSearchEntry(after));
    await this.activityLog.record({
      actor,
      action,
      entityType: 'EXPENSE',
      entityId: after.id,
      entityLabel: after.description,
      ...(detail.changes ? { changes: detail.changes } : {}),
      metadata: { code: after.code, ...detail.metadata },
    });
  }

  actorOf(user: CurrentUser): Actor {
    return actorOf(user);
  }

  nowIso(): string {
    return this.clock.now().toISOString();
  }
}

export function todayOf(clock: ClockPort): DateOnly {
  return todayInCaracas(clock.now());
}
