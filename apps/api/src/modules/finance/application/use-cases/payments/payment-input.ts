import type { FieldErrors } from '../../../../../shared/domain/domain-error';
import {
  compareMoney,
  isDecimalString,
  roundMoney,
  roundRate,
  toDecimal,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { EXPENSE_MESSAGES } from '../expenses/expense-support';
import { addError, dateError, moneyError, textError, usdRateError } from '../../field-validation';

/** Message keys of the payment forms (`payments.validation.*`, FE `PAYMENT_MESSAGES`) and the errors of this slice. */
export const PAYMENT_MESSAGES = {
  referenceRequired: 'payments.validation.referenceRequired',
  igtfExceedsAmount: 'payments.validation.igtfExceedsAmount',
  feeExceedsAmount: 'payments.validation.feeExceedsAmount',
  allocationsExceedAllocatable: 'payments.validation.allocationsExceedAllocatable',
  duplicateInvoiceAllocation: 'payments.validation.duplicateInvoiceAllocation',
  /** A voided payment is final and read-only. */
  voided: 'payments.errors.voided',
  invalidTransition: 'payments.errors.invalidTransition',
  clientLocked: 'payments.errors.clientLocked',
  allocatableBelowAllocated: 'payments.errors.allocatableBelowAllocated',
  invalidCurrency: 'validation.currency.invalid',
  required: EXPENSE_MESSAGES.required,
  tooLarge: 'validation.tooLarge',
  invalidOption: EXPENSE_MESSAGES.invalidOption,
  invalidSort: 'validation.sort.invalid',
  fileTypeNotAllowed: 'validation.file.typeNotAllowed',
  fileEmpty: 'validation.file.empty',
  fileTooLarge: 'validation.file.tooLargeMax',
} as const;

/** MIME types and size of a payment receipt (HU-14: PDF, PNG, JPG or WEBP up to 10 MB, DT-41). */
export const RECEIPT_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export const MAX_ALLOCATIONS_PER_PAYMENT = 50;

export const PAYMENT_SORT_FIELDS = [
  'code',
  'date',
  'amount',
  'amountUsd',
  'allocated',
  'unallocated',
  'reference',
  'status',
] as const;

export interface AllocationInput {
  readonly invoiceId: string;
  readonly amountPaymentCurrency: string;
  readonly amountInvoiceCurrency: string;
}

/** The fields `createPayment` and `updatePayment` share. */
export interface PaymentFields {
  readonly clientId: string;
  readonly date: string;
  readonly accountId: string;
  readonly methodId: string;
  readonly currency: string;
  readonly amount: string;
  readonly igtfAmount?: string | undefined;
  readonly feeAmount?: string | undefined;
  readonly usdRate: string;
  readonly reference?: string | null | undefined;
  /** On update: absent keeps the receipt, `null` detaches it. */
  readonly receiptFileId?: string | null | undefined;
}

export interface NormalizedPaymentFields {
  readonly clientId: string;
  readonly date: string;
  readonly accountId: string;
  readonly methodId: string;
  readonly currency: string;
  readonly amount: MoneyString;
  readonly igtfAmount: MoneyString;
  readonly feeAmount: MoneyString;
  readonly usdRate: MoneyString;
  readonly reference: string | null;
  readonly receiptFileId: string | null | undefined;
}

const CURRENCY = /^[A-Z][A-Z0-9]{2,9}$/;

function requiredId(errors: FieldErrors, path: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '') {
    addError(errors, path, PAYMENT_MESSAGES.required);
  }
}

/** A money amount that may be zero (IGTF, fee): the positive rules otherwise. */
function nonNegativeError(errors: FieldErrors, path: string, value: unknown): void {
  if (typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value) && toDecimal(value).isZero()) {
    return;
  }
  moneyError(errors, path, value);
}

const decimalOk = (value: unknown): value is string =>
  isDecimalString(value) && /^\d+(?:\.\d{1,2})?$/.test(value);

/** Shape rules of the payment fields, enforced here and never only in the DTO (lesson B2). */
export function paymentFieldErrors(input: PaymentFields): FieldErrors {
  const errors: FieldErrors = {};
  requiredId(errors, 'clientId', input.clientId);
  requiredId(errors, 'accountId', input.accountId);
  requiredId(errors, 'methodId', input.methodId);
  dateError(errors, 'date', input.date);
  if (typeof input.currency !== 'string' || !CURRENCY.test(input.currency)) {
    addError(errors, 'currency', PAYMENT_MESSAGES.invalidCurrency);
  }
  moneyError(errors, 'amount', input.amount);
  if (input.igtfAmount !== undefined) nonNegativeError(errors, 'igtfAmount', input.igtfAmount);
  if (input.feeAmount !== undefined) nonNegativeError(errors, 'feeAmount', input.feeAmount);
  if (decimalOk(input.amount)) {
    if (decimalOk(input.igtfAmount) && compareMoney(input.igtfAmount, input.amount) > 0) {
      addError(errors, 'igtfAmount', PAYMENT_MESSAGES.igtfExceedsAmount);
    }
    if (decimalOk(input.feeAmount) && compareMoney(input.feeAmount, input.amount) > 0) {
      addError(errors, 'feeAmount', PAYMENT_MESSAGES.feeExceedsAmount);
    }
  }
  usdRateError(errors, input.currency, input.usdRate);
  textError(errors, 'reference', input.reference, 80, false);
  if (
    input.receiptFileId !== undefined &&
    input.receiptFileId !== null &&
    (typeof input.receiptFileId !== 'string' || input.receiptFileId.trim() === '')
  ) {
    addError(errors, 'receiptFileId', PAYMENT_MESSAGES.required);
  }
  return errors;
}

/** Shape rules of one allocation (`path` is its field prefix). */
export function allocationFieldErrors(
  errors: FieldErrors,
  prefix: string,
  allocation: AllocationInput,
): void {
  requiredId(errors, `${prefix}invoiceId`, allocation?.invoiceId);
  moneyError(errors, `${prefix}amountPaymentCurrency`, allocation?.amountPaymentCurrency);
  moneyError(errors, `${prefix}amountInvoiceCurrency`, allocation?.amountInvoiceCurrency);
}

/** The allocations of a `createPayment` input: at most 50, one per invoice. */
export function allocationListErrors(allocations: readonly AllocationInput[]): FieldErrors {
  const errors: FieldErrors = {};
  if (allocations.length > MAX_ALLOCATIONS_PER_PAYMENT) {
    addError(errors, 'allocations', PAYMENT_MESSAGES.tooLarge);
    return errors;
  }
  allocations.forEach((allocation, index) => {
    allocationFieldErrors(errors, `allocations.${index}.`, allocation);
    if (allocations.findIndex((other) => other?.invoiceId === allocation?.invoiceId) !== index) {
      addError(
        errors,
        `allocations.${index}.invoiceId`,
        PAYMENT_MESSAGES.duplicateInvoiceAllocation,
      );
    }
  });
  return errors;
}

/** The input with its amounts rounded to the column scales and its optional parts resolved. */
export function normalizePaymentFields(input: PaymentFields): NormalizedPaymentFields {
  const reference = input.reference?.trim();
  return {
    clientId: input.clientId,
    date: input.date,
    accountId: input.accountId,
    methodId: input.methodId,
    currency: input.currency,
    amount: roundMoney(input.amount),
    igtfAmount: roundMoney(input.igtfAmount ?? '0'),
    feeAmount: roundMoney(input.feeAmount ?? '0'),
    usdRate: roundRate(input.usdRate),
    reference: reference ? reference : null,
    receiptFileId: input.receiptFileId,
  };
}
