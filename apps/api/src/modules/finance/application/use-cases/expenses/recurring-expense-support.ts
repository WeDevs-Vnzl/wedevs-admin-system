import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import { FREQUENCY_VALUES } from '../../../../../shared/domain/enums';
import type { FieldErrors } from '../../../../../shared/domain/domain-error';
import type { Frequency } from '../../../../../shared/domain/enums';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { roundMoney, toUsd } from '../../../../../shared/domain/money';
import { EXPENSE_ERRORS } from '../../../domain/errors';
import { normalizeToMonth } from '../../../domain/recurring';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import type { ExpenseReferencesPort } from '../../ports/expense-references.port';
import type {
  RecurringExpenseRecord,
  RecurringExpenseRepository,
} from '../../ports/expense-recurring.repository.port';
import {
  EXPENSE_MESSAGES,
  type RecurringExpenseOutput,
  nextDueDateOf,
  todayOf,
} from './expense-support';
import { addError, dateError, invalid, moneyError, textError } from '../../field-validation';

export interface RecurringExpenseInput {
  readonly name: string;
  readonly vendor?: string | null | undefined;
  readonly categoryId: string;
  /** Default payment account of the generated expenses. */
  readonly accountId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly currency: string;
  /** Estimated amount; adjusted when each period is marked as paid. */
  readonly amount: string;
  readonly frequency: Frequency;
  /** Day of the period on which the expense falls (1–28). */
  readonly dayOfPeriod: number;
  readonly leadDays: number;
  readonly startDate: DateOnly;
  readonly endDate?: DateOnly | null | undefined;
}

/** The field rules of a schedule (day 1–28, lead days 0–60, end after start); never only in the DTO. */
export function recurringInputErrors(input: RecurringExpenseInput): FieldErrors {
  const errors: FieldErrors = {};
  textError(errors, 'name', input.name, 120, true);
  textError(errors, 'vendor', input.vendor, 120, false);
  moneyError(errors, 'amount', input.amount);
  if (!(FREQUENCY_VALUES as readonly unknown[]).includes(input.frequency)) {
    addError(errors, 'frequency', EXPENSE_MESSAGES.invalidOption);
  }
  if (!Number.isInteger(input.dayOfPeriod) || input.dayOfPeriod < 1 || input.dayOfPeriod > 28) {
    addError(errors, 'dayOfPeriod', EXPENSE_MESSAGES.billingDayRange);
  }
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 60) {
    addError(errors, 'leadDays', EXPENSE_MESSAGES.leadDaysRange);
  }
  const startOk = dateError(errors, 'startDate', input.startDate);
  if (input.endDate !== undefined && input.endDate !== null) {
    if (dateError(errors, 'endDate', input.endDate) && startOk && input.endDate < input.startDate) {
      addError(errors, 'endDate', EXPENSE_MESSAGES.endBeforeStart);
    }
  }
  return errors;
}

/**
 * Shared steps of the schedule use cases: the USD snapshot (`usdRate`, `monthlyAmountUsd`, Δ10), the
 * references, and the output with its derived next period. Valid inside the caller's unit of work.
 */
export class RecurringExpenseSupport {
  constructor(
    readonly recurring: RecurringExpenseRepository,
    readonly references: ExpenseReferencesPort,
    private readonly rates: ExchangeRatePort,
    private readonly currencies: CurrencyCatalogPort,
    readonly locks: RowLocksPort,
    readonly activityLog: ActivityLogPort,
    readonly clock: ClockPort,
  ) {}

  /**
   * The rate on or before the business day. A non-USD schedule without one cannot be saved
   * (`fieldErrors.currency = ["expenses.errors.rateMissing"]`): its monthly USD value would be unknown.
   */
  async snapshot(
    input: Pick<RecurringExpenseInput, 'currency' | 'amount' | 'frequency'>,
  ): Promise<Pick<RecurringExpenseRecord, 'amount' | 'usdRate' | 'monthlyAmountUsd'>> {
    const known = await this.currencies.knownCodes([input.currency]);
    if (!known.has(input.currency)) throw invalid('currency', EXPENSE_MESSAGES.unknownCurrency);
    const selected = await this.rates.getRateFor(todayOf(this.clock), input.currency);
    if (!selected) throw invalid('currency', EXPENSE_ERRORS.rateMissing);
    const amount = roundMoney(input.amount);
    return {
      amount,
      usdRate: selected.usdRate,
      monthlyAmountUsd: toUsd(normalizeToMonth(amount, input.frequency), selected.usdRate),
    };
  }

  async requireRefs(input: RecurringExpenseInput): Promise<void> {
    if (!(await this.references.activeCategory(input.categoryId))) {
      throw invalid('categoryId', EXPENSE_ERRORS.categoryUnavailable);
    }
    if (input.accountId && !(await this.references.activeAccount(input.accountId))) {
      throw invalid('accountId', EXPENSE_ERRORS.accountUnavailable);
    }
    if (input.projectId && !(await this.references.liveProject(input.projectId))) {
      throw invalid('projectId', EXPENSE_ERRORS.projectUnavailable);
    }
  }

  async output(id: string): Promise<RecurringExpenseOutput> {
    const view = await this.recurring.view(id);
    if (!view) throw new NotFoundError();
    const periods = await this.recurring.periodsOf([id]);
    return { ...view, nextDueDate: nextDueDateOf(view, periods.get(id) ?? []) };
  }
}
