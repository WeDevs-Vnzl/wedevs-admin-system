import {
  addDays,
  isValidDateOnly,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import {
  INSTALLMENT_KIND_VALUES,
  type Frequency,
  type InstallmentKind,
} from '../../../../../shared/domain/enums';
import {
  compareMoney,
  isDecimalString,
  isNegativeMoney,
  isZeroMoney,
  sumMoney,
  toUsd,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { installmentSumMismatch } from '../../../domain/installments';
import {
  dueRecurringPeriods,
  normalizeToMonth,
  type RecurringPeriod,
} from '../../../domain/recurring';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import type {
  BillingPlanRecord,
  BillingRepository,
  InstallmentRecord,
  RecurringChargeRecord,
} from '../../ports/billing.repository.port';

export { INSTALLMENT_TEMPLATE_VALUES } from '../../../domain/installments';

/** i18n keys of the domain errors (`billing.errors.*`), shown by the form or the toast. */
export const BILLING_ERRORS = {
  planRequired: 'billing.errors.planRequired',
  rateMissing: 'billing.errors.rateMissing',
  currencyLocked: 'billing.errors.currencyLocked',
  installmentBilled: 'billing.errors.installmentBilled',
  installmentCancelled: 'billing.errors.installmentCancelled',
  chargeFinished: 'billing.errors.chargeFinished',
} as const;

/** i18n keys of the shape rules (`billing.validation.*`, `validation.*`). */
export const BILLING_MESSAGES = {
  billingDayRange: 'billing.validation.billingDayRange',
  leadDaysRange: 'billing.validation.leadDaysRange',
  contractAmountRequired: 'billing.validation.contractAmountRequired',
  customInstallmentsRequired: 'billing.validation.customInstallmentsRequired',
  templateInstallmentsNotAllowed: 'billing.validation.templateInstallmentsNotAllowed',
  endBeforeStart: 'billing.validation.endBeforeStart',
  adjustmentNonZero: 'billing.validation.adjustmentNonZero',
  installmentKindNotManual: 'billing.validation.installmentKindNotManual',
  nothingToUpdate: 'billing.validation.nothingToUpdate',
  required: 'validation.required',
  invalidMoney: 'validation.money.invalid',
  moneyMustBePositive: 'validation.money.mustBePositive',
  invalidCurrency: 'validation.currency.invalid',
  invalidDate: 'validation.date.invalid',
} as const;

/** Guard on the periods one generation may create; a sane schedule never reaches it. */
export const MAX_PERIODS_PER_RUN = 24;
/** Guard on the periods one walk may pass over (existing and skipped ones included). */
export const MAX_PERIODS_WALKED = 600;
export const MAX_CUSTOM_INSTALLMENTS = 60;
export const DEFAULT_RECURRING_LEAD_DAYS = 7;

const MAX_LABEL = 120;
const MAX_TRIGGER = 200;
const MAX_NOTES = 2000;
const CURRENCY_CODE = /^[A-Z][A-Z0-9]{2,9}$/;
const MAX_ORDER = 999;

export function invalid(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ fieldErrors: { [field]: [key] } });
}

/** Collects field errors and throws one `VALIDATION` with all of them. */
export class FieldCollector {
  private readonly errors: FieldErrors = {};

  add(path: string, key: string): void {
    (this.errors[path] ??= []).push(key);
  }

  throwIfAny(): void {
    if (Object.keys(this.errors).length > 0)
      throw new ValidationFailedError({ fieldErrors: this.errors });
  }
}

// ───────────────────────────── Shape rules (enforced here, never only in a DTO) ─────────────────────────────

/** A money amount: a plain decimal string with at most 2 decimals. `null` when it is well formed. */
function moneyShapeError(value: unknown): string | null {
  if (!isDecimalString(value) || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    return BILLING_MESSAGES.invalidMoney;
  }
  return null;
}

/** Amount rule of an installment: `AJUSTE` may be negative and never zero, every other kind is positive. */
export function installmentAmountError(kind: InstallmentKind, amount: unknown): string | null {
  const shape = moneyShapeError(amount);
  if (shape !== null) return shape;
  const value = amount as string;
  if (kind === 'AJUSTE') return isZeroMoney(value) ? BILLING_MESSAGES.adjustmentNonZero : null;
  return isZeroMoney(value) || isNegativeMoney(value) ? BILLING_MESSAGES.moneyMustBePositive : null;
}

export function positiveAmountError(amount: unknown): string | null {
  const shape = moneyShapeError(amount);
  if (shape !== null) return shape;
  const value = amount as string;
  return isZeroMoney(value) || isNegativeMoney(value) ? BILLING_MESSAGES.moneyMustBePositive : null;
}

export function currencyShapeError(code: unknown): string | null {
  return typeof code === 'string' && CURRENCY_CODE.test(code)
    ? null
    : BILLING_MESSAGES.invalidCurrency;
}

export function dateError(value: unknown): string | null {
  return typeof value === 'string' && isValidDateOnly(value) ? null : BILLING_MESSAGES.invalidDate;
}

export function labelError(value: unknown, max = MAX_LABEL): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    ? null
    : BILLING_MESSAGES.required;
}

export function percentageError(value: unknown): string | null {
  if (!isDecimalString(value) || !/^\d+(?:\.\d{1,2})?$/.test(value))
    return BILLING_MESSAGES.invalidMoney;
  return compareMoney(value, '100') > 0 ? BILLING_MESSAGES.invalidMoney : null;
}

export function triggerError(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_TRIGGER
    ? null
    : BILLING_MESSAGES.required;
}

export function notesError(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_NOTES ? null : BILLING_MESSAGES.required;
}

export function orderError(value: unknown): string | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_ORDER
    ? null
    : BILLING_MESSAGES.required;
}

export function billingDayError(value: unknown): string | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 28
    ? null
    : BILLING_MESSAGES.billingDayRange;
}

export function leadDaysError(value: unknown): string | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60
    ? null
    : BILLING_MESSAGES.leadDaysRange;
}

export function isInstallmentKind(value: unknown): value is InstallmentKind {
  return (INSTALLMENT_KIND_VALUES as readonly unknown[]).includes(value);
}

/** The schedule fields every recurring charge create and edit share. */
export interface RecurringScheduleInput {
  readonly label: string;
  readonly amount: MoneyString;
  readonly currency: string;
  readonly frequency: Frequency;
  readonly startDate: DateOnly;
  readonly endDate?: DateOnly | null | undefined;
  readonly billingDay: number;
  readonly leadDays: number;
}

export function validateSchedule(input: RecurringScheduleInput, errors: FieldCollector): void {
  const check = (path: string, key: string | null) => key !== null && errors.add(path, key);
  check('label', labelError(input.label));
  check('amount', positiveAmountError(input.amount));
  check('currency', currencyShapeError(input.currency));
  check('startDate', dateError(input.startDate));
  check('billingDay', billingDayError(input.billingDay));
  check('leadDays', leadDaysError(input.leadDays));
  if (input.endDate !== undefined && input.endDate !== null) {
    const endError = dateError(input.endDate);
    if (endError !== null) errors.add('endDate', endError);
    else if (dateError(input.startDate) === null && input.endDate < input.startDate) {
      errors.add('endDate', BILLING_MESSAGES.endBeforeStart);
    }
  }
}

// ───────────────────────────── Snapshots and schedule ─────────────────────────────

/** `toUsd(normalizeToMonth(amount, frequency), usdRate)`: the value `RecomputeAll` rebuilds (C16, C17). */
export function monthlyUsdOf(
  amount: MoneyString,
  frequency: Frequency,
  usdRate: MoneyString,
): MoneyString {
  return toUsd(normalizeToMonth(amount, frequency), usdRate);
}

export type GeneratedPeriod = RecurringPeriod;

/**
 * The periods of one charge that are due by `asOf`, one per step, each with its own `generateOn` reached,
 * never one that exists (HU-10 CA1, CA2). The daily step continues after the last existing period and skips
 * the periods whose generation day fell before the last resume (PRD §8.4.3); the on-request path
 * (`ignoreStatus`) walks from the first period, fills the gaps and ignores the pause.
 */
export function periodsToGenerate(
  charge: Pick<
    RecurringChargeRecord,
    'frequency' | 'startDate' | 'endDate' | 'billingDay' | 'leadDays' | 'status' | 'resumedOn'
  >,
  existingPeriodStarts: readonly DateOnly[],
  asOf: DateOnly,
  options: { ignoreStatus?: boolean } = {},
): GeneratedPeriod[] {
  const skipBefore = options.ignoreStatus ? null : charge.resumedOn;
  const schedule = {
    frequency: charge.frequency,
    startDate: charge.startDate,
    endDate: charge.endDate,
    billingDay: charge.billingDay,
    leadDays: charge.leadDays,
    status: options.ignoreStatus ? ('ACTIVO' as const) : charge.status,
  };
  const existing = new Set(existingPeriodStarts);
  const skipped: DateOnly[] = [];
  const walked: DateOnly[] = options.ignoreStatus ? [] : [...existing];
  const created: GeneratedPeriod[] = [];
  for (
    let guard = 0;
    guard < MAX_PERIODS_WALKED && created.length < MAX_PERIODS_PER_RUN;
    guard += 1
  ) {
    const [due] = dueRecurringPeriods(schedule, [...walked, ...skipped], asOf);
    if (!due) break;
    if (existing.has(due.periodStart)) {
      walked.push(due.periodStart);
      continue;
    }
    if (skipBefore !== null && due.generateOn < skipBefore) {
      skipped.push(due.periodStart);
      continue;
    }
    existing.add(due.periodStart);
    walked.push(due.periodStart);
    created.push(due);
  }
  return created;
}

/** The last day an on-request generation reaches by default: the lead days after `today`. */
export function defaultUpTo(today: DateOnly, leadDays: number): DateOnly {
  return addDays(today, leadDays);
}

// ───────────────────────────── Output models ─────────────────────────────

export type InstallmentView = InstallmentRecord;

export interface BillingPlanView {
  readonly id: string;
  readonly projectId: string;
  readonly model: BillingPlanRecord['model'];
  readonly currency: string;
  readonly contractAmount: MoneyString | null;
  readonly notes: string | null;
  readonly installments: readonly InstallmentView[];
  /** Sum of the non-`AJUSTE`, non-cancelled installments (PRD §8.4.2 sum validation). */
  readonly installmentsTotal: MoneyString;
  /** Installments minus contract when it exceeds ±0.01; `null` otherwise and for plans without a contract. */
  readonly scheduleDifference: MoneyString | null;
  readonly scheduleConsistent: boolean;
  readonly contractedUsd: MoneyString | null;
  readonly usdRate: MoneyString | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecurringChargeView {
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
  readonly status: RecurringChargeRecord['status'];
  readonly lastGeneratedPeriodStart: DateOnly | null;
  readonly resumedOn: DateOnly | null;
  /** Amount normalized to a month in the charge currency (quarterly ÷ 3, …). */
  readonly monthlyAmount: MoneyString;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Everything the billing screen reads for one project. */
export interface BillingPageView {
  readonly projectId: string;
  readonly plan: BillingPlanView | null;
  /** Every installment of the project (template, manual or recurring), by `order`; cancelled ones included. */
  readonly installments: readonly InstallmentView[];
  readonly recurringCharges: readonly RecurringChargeView[];
}

export function planView(
  plan: BillingPlanRecord,
  installments: readonly InstallmentRecord[],
): BillingPlanView {
  const own = installments.filter((item) => item.billingPlanId === plan.id);
  const counted = own.map((item) => ({
    amount: item.amount,
    kind: item.kind,
    cancelled: item.cancelledAt !== null,
  }));
  const difference =
    plan.contractAmount !== null ? installmentSumMismatch(plan.contractAmount, counted) : null;
  return {
    id: plan.id,
    projectId: plan.projectId,
    model: plan.model,
    currency: plan.currency,
    contractAmount: plan.contractAmount,
    notes: plan.notes,
    installments: own,
    installmentsTotal: sumMoney(
      counted
        .filter((item) => item.kind !== 'AJUSTE' && !item.cancelled)
        .map((item) => item.amount),
    ),
    scheduleDifference: difference,
    scheduleConsistent: difference === null,
    contractedUsd: plan.contractedUsd,
    usdRate: plan.usdRate,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function chargeView(charge: RecurringChargeRecord): RecurringChargeView {
  return {
    id: charge.id,
    projectId: charge.projectId,
    label: charge.label,
    amount: charge.amount,
    currency: charge.currency,
    frequency: charge.frequency,
    startDate: charge.startDate,
    endDate: charge.endDate,
    billingDay: charge.billingDay,
    leadDays: charge.leadDays,
    status: charge.status,
    lastGeneratedPeriodStart: charge.lastGeneratedPeriodStart,
    resumedOn: charge.resumedOn,
    monthlyAmount: normalizeToMonth(charge.amount, charge.frequency),
    createdAt: charge.createdAt,
    updatedAt: charge.updatedAt,
  };
}

export function buildPage(
  projectId: string,
  plan: BillingPlanRecord | null,
  installments: readonly InstallmentRecord[],
  charges: readonly RecurringChargeRecord[],
): BillingPageView {
  return {
    projectId,
    plan: plan ? planView(plan, installments) : null,
    installments,
    recurringCharges: charges.map(chargeView),
  };
}

/** Reads the whole billing page of a project; call it inside the unit of work that wrote. */
export async function loadPage(
  repository: BillingRepository,
  projectId: string,
): Promise<BillingPageView> {
  const [plan, installments, charges] = [
    await repository.findPlan(projectId),
    await repository.listInstallments(projectId),
    await repository.listCharges(projectId),
  ];
  return buildPage(projectId, plan, installments, charges);
}

/** A currency the catalog does not know is a field error, not a foreign key failure. */
export async function assertKnownCurrencies(
  catalog: CurrencyCatalogPort,
  codes: readonly { path: string; code: string }[],
): Promise<void> {
  const known = await catalog.knownCodes([...new Set(codes.map((item) => item.code))]);
  const errors = new FieldCollector();
  for (const item of codes)
    if (!known.has(item.code)) errors.add(item.path, BILLING_MESSAGES.invalidCurrency);
  errors.throwIfAny();
}

/** The `usdRate` of a currency on a business day, or `null` when there is none (the caller types it). */
export async function usdRateOn(
  rates: ExchangeRatePort,
  date: DateOnly,
  currency: string,
): Promise<MoneyString | null> {
  const selected = await rates.getRateFor(date, currency);
  return selected === null ? null : selected.usdRate;
}
