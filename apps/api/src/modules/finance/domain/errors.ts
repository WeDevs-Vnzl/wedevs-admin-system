/**
 * i18n keys of the finance domain errors, verbatim from the Hito 1 mock services (the FE already
 * ships the translations). The BE returns keys, never translated text (api-contract §4).
 */

/** `invoices.errors.*` and `invoices.validation.*` (mock `INVOICE_ERRORS`). */
export const INVOICE_ERRORS = {
  numberTaken: 'invoices.errors.numberTaken',
  voided: 'invoices.errors.voided',
  alreadyVoided: 'invoices.errors.alreadyVoided',
  archived: 'invoices.errors.archived',
  alreadyArchived: 'invoices.errors.alreadyArchived',
  notDraft: 'invoices.errors.notDraft',
  hasAllocations: 'invoices.errors.hasAllocations',
  receivableBelowPaid: 'invoices.errors.receivableBelowPaid',
  clientLocked: 'invoices.errors.clientLocked',
  projectOtherClient: 'invoices.errors.projectOtherClient',
  installmentCancelled: 'invoices.errors.installmentCancelled',
  installmentExceeded: 'invoices.errors.installmentExceeded',
  installmentCurrency: 'invoices.errors.installmentCurrency',
  invalidTotals: 'invoices.validation.invalidTotals',
  fileType: 'invoices.validation.fileType',
  fileTooLarge: 'invoices.validation.fileTooLarge',
  fileNotReady: 'invoices.validation.fileNotReady',
} as const;

/** `billing.errors.*` (mock `BILLING_ERRORS`). */
export const BILLING_ERRORS = {
  planRequired: 'billing.errors.planRequired',
  rateMissing: 'billing.errors.rateMissing',
  currencyLocked: 'billing.errors.currencyLocked',
  installmentBilled: 'billing.errors.installmentBilled',
  installmentCancelled: 'billing.errors.installmentCancelled',
  chargeFinished: 'billing.errors.chargeFinished',
} as const;

/** `expenses.errors.*` (mock `EXPENSE_ERRORS`). */
export const EXPENSE_ERRORS = {
  notPending: 'expenses.errors.notPending',
  voided: 'expenses.errors.voided',
  recurringFinished: 'expenses.errors.recurringFinished',
  categoryUnavailable: 'expenses.errors.categoryUnavailable',
  accountUnavailable: 'expenses.errors.accountUnavailable',
  projectUnavailable: 'expenses.errors.projectUnavailable',
  receiptUnavailable: 'expenses.errors.receiptUnavailable',
  rateMissing: 'expenses.errors.rateMissing',
} as const;

/** `payments.validation.*` (mock `PAYMENT_SERVICE_MESSAGES`; `accountInactive` is an `accounts` key). */
export const PAYMENT_ERRORS = {
  currencyMismatch: 'payments.validation.currencyMismatch',
  allocationExceedsBalance: 'payments.validation.allocationExceedsBalance',
  allocationInvoiceNotOpen: 'payments.validation.allocationInvoiceNotOpen',
  allocationSameCurrency: 'payments.validation.allocationSameCurrency',
  accountInactive: 'accounts.validation.inactive',
  paymentNotConfirmed: 'payments.validation.paymentNotConfirmed',
} as const;

/** `accounts.validation.*` (mock accounts `MESSAGES`). */
export const ACCOUNT_ERRORS = {
  inactive: 'accounts.validation.inactive',
  currencyLocked: 'accounts.validation.currencyLocked',
} as const;

/** Exchange-rate keys (mock catalogs `MESSAGES.unknownCurrency`). */
export const RATE_ERRORS = {
  unknownCurrency: 'catalogs.rates.errors.unknownCurrency',
} as const;
