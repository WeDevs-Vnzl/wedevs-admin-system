import { isValidDateOnly, type DateOnly } from '../../../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import {
  compareMoney,
  isDecimalString,
  roundMoney,
  toDecimal,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { IVA_ADJUSTMENT_LIMIT } from '../../../domain/invoice-totals';

/** Message keys of the invoice forms (`invoices.validation.*`, FE `INVOICE_MESSAGES`) and the shared shape ones. */
export const INVOICE_MESSAGES = {
  discountExceedsAmount: 'invoices.validation.discountExceedsAmount',
  ivaRateNotAllowed: 'invoices.validation.ivaRateNotAllowed',
  adjustmentOutOfRange: 'invoices.validation.adjustmentOutOfRange',
  adjustmentRateNotInLines: 'invoices.validation.adjustmentRateNotInLines',
  duplicateAdjustmentRate: 'invoices.validation.duplicateAdjustmentRate',
  dueBeforeIssue: 'invoices.validation.dueBeforeIssue',
  otherWithheldNoteRequired: 'invoices.validation.otherWithheldNoteRequired',
  duplicateInstallment: 'invoices.validation.duplicateInstallment',
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
  invalidSort: 'validation.sort.invalid',
} as const;

export const MAX_INVOICE_LINES = 200;
export const MAX_TAX_ADJUSTMENTS = 10;
const CURRENCY_CODE = /^[A-Z][A-Z0-9]{2,9}$/;

export interface InvoiceLineInput {
  /** Present when editing an existing line. */
  readonly id?: string | undefined;
  readonly description: string;
  readonly projectId?: string | null | undefined;
  readonly installmentId?: string | null | undefined;
  readonly quantity?: string | undefined;
  readonly unitPrice: string;
  readonly discount?: string | undefined;
  /** `null` is exempt. */
  readonly ivaRate: string | null;
}

export interface IvaAdjustmentInput {
  readonly ivaRate: string;
  readonly adjustment: string;
}

/** The whole invoice, as `createInvoice` and `updateInvoice` receive it (the FE `createInvoiceInput`). */
export interface InvoiceInput {
  readonly clientId: string;
  readonly invoiceNumber: string;
  readonly controlNumber?: string | null | undefined;
  readonly issueDate: DateOnly;
  readonly dueDate: DateOnly;
  readonly currency: string;
  readonly usdRate: string;
  readonly bcvRate?: string | null | undefined;
  readonly lines: readonly InvoiceLineInput[];
  readonly taxAdjustments?: readonly IvaAdjustmentInput[] | undefined;
  readonly ivaWithheld?: string | undefined;
  readonly islrWithheld?: string | undefined;
  readonly otherWithheld?: string | undefined;
  readonly otherWithheldNote?: string | null | undefined;
  /** `undefined` keeps the file of an edit, `null` detaches it. */
  readonly fileId?: string | null | undefined;
  readonly isDraft?: boolean | undefined;
}

export interface NormalizedLine {
  readonly id: string | undefined;
  readonly description: string;
  readonly projectId: string | null;
  readonly installmentId: string | null;
  readonly quantity: MoneyString;
  readonly unitPrice: MoneyString;
  readonly discount: MoneyString;
  readonly ivaRate: MoneyString | null;
}

/** An input after its shape was checked: defaults applied, text trimmed, money at two decimals. */
export interface NormalizedInvoiceInput {
  readonly clientId: string;
  readonly invoiceNumber: string;
  readonly controlNumber: string | null;
  readonly issueDate: DateOnly;
  readonly dueDate: DateOnly;
  readonly currency: string;
  readonly usdRate: MoneyString;
  readonly bcvRate: MoneyString | null;
  readonly lines: readonly NormalizedLine[];
  readonly taxAdjustments: readonly IvaAdjustmentInput[];
  readonly ivaWithheld: MoneyString;
  readonly islrWithheld: MoneyString;
  readonly otherWithheld: MoneyString;
  readonly otherWithheldNote: string | null;
  readonly fileId: string | null | undefined;
  readonly isDraft: boolean;
}

function addError(errors: FieldErrors, path: string, key: string): void {
  errors[path] = [...(errors[path] ?? []), key];
}

/** `VALIDATION` on one field with one i18n key. */
export function invalid(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ fieldErrors: { [field]: [key] } });
}

export function throwIfAny(errors: FieldErrors): void {
  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
}

/** Same rate whatever its notation (`"16"` and `"16.00"`). */
export function sameRate(a: string, b: string): boolean {
  return toDecimal(a).equals(toDecimal(b));
}

function dateError(errors: FieldErrors, path: string, value: unknown): value is string {
  if (typeof value === 'string' && isValidDateOnly(value)) return true;
  addError(errors, path, INVOICE_MESSAGES.invalidDate);
  return false;
}

/** A money amount: decimal string, at most 2 decimals and `integerDigits` integer digits, never negative. */
function moneyError(
  errors: FieldErrors,
  path: string,
  value: unknown,
  rules: { positive: boolean; integerDigits: number; signed?: boolean },
): void {
  if (!isDecimalString(value) || (!rules.signed && value.startsWith('-'))) {
    addError(errors, path, INVOICE_MESSAGES.invalidMoney);
    return;
  }
  const integerPart = new RegExp(`^-?(?:0|[1-9]\\d{0,${rules.integerDigits - 1}})(?:\\.\\d+)?$`);
  if (!integerPart.test(value)) {
    addError(errors, path, INVOICE_MESSAGES.moneyOutOfRange);
  } else if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    addError(errors, path, INVOICE_MESSAGES.moneyTooManyDecimals);
  } else if (rules.positive && toDecimal(value).isZero()) {
    addError(errors, path, INVOICE_MESSAGES.moneyMustBePositive);
  }
}

/** A rate: decimal string > 0, at most 8 decimals and 12 integer digits (`Decimal(20,8)`). */
function rateError(errors: FieldErrors, path: string, value: unknown): boolean {
  if (!isDecimalString(value) || value.startsWith('-')) {
    addError(errors, path, INVOICE_MESSAGES.invalidRate);
  } else if (!/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(value)) {
    addError(errors, path, INVOICE_MESSAGES.rateOutOfRange);
  } else if (!/^\d+(?:\.\d{1,8})?$/.test(value)) {
    addError(errors, path, INVOICE_MESSAGES.rateTooManyDecimals);
  } else if (toDecimal(value).isZero()) {
    addError(errors, path, INVOICE_MESSAGES.rateMustBePositive);
  } else {
    return true;
  }
  return false;
}

function textError(
  errors: FieldErrors,
  path: string,
  value: unknown,
  max: number,
  required: boolean,
): void {
  if (value === undefined || value === null) {
    if (required) addError(errors, path, INVOICE_MESSAGES.required);
    return;
  }
  if (typeof value !== 'string' || (required && value.trim() === '')) {
    addError(errors, path, INVOICE_MESSAGES.required);
  } else if (value.trim().length > max) {
    addError(errors, path, INVOICE_MESSAGES.tooLong);
  }
}

/** The amount of a line: `round(quantity × unitPrice, 2)`, or `null` while an operand is not a decimal. */
function lineAmountOf(quantity: unknown, unitPrice: unknown): string | null {
  if (!isDecimalString(quantity) || !isDecimalString(unitPrice)) return null;
  return roundMoney(toDecimal(quantity).times(toDecimal(unitPrice)).toString());
}

function positiveWithheld(value: unknown): boolean {
  return isDecimalString(value) && toDecimal(value).greaterThan(0);
}

/**
 * The shape rules of an invoice input (the FE `createInvoiceInputSchemaFor`): enforced here, never only in the
 * DTO (lesson B2). Every error is collected, keyed by input path, with the key the form already translates.
 */
export function invoiceInputErrors(
  input: InvoiceInput,
  allowedIvaRates: readonly string[],
): FieldErrors {
  const errors: FieldErrors = {};
  textError(errors, 'clientId', input.clientId, 64, true);
  textError(errors, 'invoiceNumber', input.invoiceNumber, 40, true);
  textError(errors, 'controlNumber', input.controlNumber, 40, false);
  const issueOk = dateError(errors, 'issueDate', input.issueDate);
  const dueOk = dateError(errors, 'dueDate', input.dueDate);
  if (issueOk && dueOk && input.dueDate < input.issueDate) {
    addError(errors, 'dueDate', INVOICE_MESSAGES.dueBeforeIssue);
  }

  if (typeof input.currency !== 'string' || !CURRENCY_CODE.test(input.currency)) {
    addError(errors, 'currency', INVOICE_MESSAGES.invalidOption);
  }
  if (rateError(errors, 'usdRate', input.usdRate)) {
    if (input.currency === 'USD' && compareMoney(input.usdRate, '1') !== 0) {
      addError(errors, 'usdRate', INVOICE_MESSAGES.usdRateMustBeOne);
    }
  }
  if (input.bcvRate !== undefined && input.bcvRate !== null) {
    rateError(errors, 'bcvRate', input.bcvRate);
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    addError(errors, 'lines', INVOICE_MESSAGES.required);
  } else if (input.lines.length > MAX_INVOICE_LINES) {
    addError(errors, 'lines', INVOICE_MESSAGES.tooLong);
  } else {
    lineErrors(errors, input.lines, allowedIvaRates);
  }

  adjustmentErrors(errors, input);

  for (const field of ['ivaWithheld', 'islrWithheld', 'otherWithheld'] as const) {
    const value = input[field];
    if (value !== undefined)
      moneyError(errors, field, value, { positive: false, integerDigits: 16 });
  }
  textError(errors, 'otherWithheldNote', input.otherWithheldNote, 200, false);
  if (positiveWithheld(input.otherWithheld) && !input.otherWithheldNote?.trim()) {
    addError(errors, 'otherWithheldNote', INVOICE_MESSAGES.otherWithheldNoteRequired);
  }
  return errors;
}

function lineErrors(
  errors: FieldErrors,
  lines: readonly InvoiceLineInput[],
  allowedIvaRates: readonly string[],
): void {
  const seenInstallments = new Set<string>();
  lines.forEach((line, index) => {
    const at = (field: string) => `lines.${index}.${field}`;
    textError(errors, at('description'), line.description, 300, true);
    moneyError(errors, at('quantity'), line.quantity ?? '1', { positive: true, integerDigits: 10 });
    moneyError(errors, at('unitPrice'), line.unitPrice, { positive: true, integerDigits: 16 });
    moneyError(errors, at('discount'), line.discount ?? '0', {
      positive: false,
      integerDigits: 16,
    });

    const amount = lineAmountOf(line.quantity ?? '1', line.unitPrice);
    if (
      amount !== null &&
      isDecimalString(line.discount ?? '0') &&
      compareMoney(line.discount ?? '0', amount) > 0
    ) {
      addError(errors, at('discount'), INVOICE_MESSAGES.discountExceedsAmount);
    }

    const rate = line.ivaRate;
    if (
      rate !== null &&
      (typeof rate !== 'string' ||
        !isDecimalString(rate) ||
        !allowedIvaRates.some((allowed) => isDecimalString(allowed) && sameRate(allowed, rate)))
    ) {
      addError(errors, at('ivaRate'), INVOICE_MESSAGES.ivaRateNotAllowed);
    }

    if (line.installmentId) {
      if (seenInstallments.has(line.installmentId)) {
        addError(errors, at('installmentId'), INVOICE_MESSAGES.duplicateInstallment);
      }
      seenInstallments.add(line.installmentId);
    }
  });
}

function adjustmentErrors(errors: FieldErrors, input: InvoiceInput): void {
  const adjustments = input.taxAdjustments ?? [];
  if (adjustments.length > MAX_TAX_ADJUSTMENTS) {
    addError(errors, 'taxAdjustments', INVOICE_MESSAGES.tooLong);
    return;
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  adjustments.forEach((adjustment, index) => {
    const at = (field: string) => `taxAdjustments.${index}.${field}`;
    if (!isDecimalString(adjustment.ivaRate)) {
      addError(errors, at('ivaRate'), INVOICE_MESSAGES.invalidOption);
      return;
    }
    const usedByLines = lines.some(
      (line) =>
        typeof line.ivaRate === 'string' &&
        isDecimalString(line.ivaRate) &&
        sameRate(line.ivaRate, adjustment.ivaRate),
    );
    // A 0 % rate has no IVA to adjust: it behaves like an exempt line.
    if (!usedByLines || toDecimal(adjustment.ivaRate).isZero()) {
      addError(errors, at('ivaRate'), INVOICE_MESSAGES.adjustmentRateNotInLines);
    }
    const first = adjustments.findIndex(
      (other) => isDecimalString(other.ivaRate) && sameRate(other.ivaRate, adjustment.ivaRate),
    );
    if (first !== index) addError(errors, at('ivaRate'), INVOICE_MESSAGES.duplicateAdjustmentRate);

    if (!isDecimalString(adjustment.adjustment)) {
      addError(errors, at('adjustment'), INVOICE_MESSAGES.invalidMoney);
    } else if (toDecimal(adjustment.adjustment).abs().greaterThan(IVA_ADJUSTMENT_LIMIT)) {
      addError(errors, at('adjustment'), INVOICE_MESSAGES.adjustmentOutOfRange);
    }
  });
}

/** The input after `invoiceInputErrors` found nothing: defaults applied, text trimmed, money at two decimals. */
export function normalizeInvoiceInput(input: InvoiceInput): NormalizedInvoiceInput {
  const note = input.otherWithheldNote?.trim();
  return {
    clientId: input.clientId,
    invoiceNumber: input.invoiceNumber.trim(),
    controlNumber: input.controlNumber?.trim() || null,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    usdRate: input.usdRate,
    bcvRate: input.bcvRate ?? null,
    lines: input.lines.map((line) => ({
      id: line.id,
      description: line.description.trim(),
      projectId: line.projectId || null,
      installmentId: line.installmentId || null,
      quantity: line.quantity ?? '1',
      unitPrice: roundMoney(line.unitPrice),
      discount: roundMoney(line.discount ?? '0'),
      ivaRate: line.ivaRate,
    })),
    taxAdjustments: (input.taxAdjustments ?? []).map((adjustment) => ({
      ivaRate: adjustment.ivaRate,
      adjustment: roundMoney(adjustment.adjustment),
    })),
    ivaWithheld: roundMoney(input.ivaWithheld ?? '0'),
    islrWithheld: roundMoney(input.islrWithheld ?? '0'),
    otherWithheld: roundMoney(input.otherWithheld ?? '0'),
    otherWithheldNote: note || null,
    fileId: input.fileId,
    isDraft: input.isDraft ?? false,
  };
}
