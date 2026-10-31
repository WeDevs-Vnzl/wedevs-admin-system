import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ERRORS,
  BILLING_ERRORS,
  EXPENSE_ERRORS,
  INVOICE_ERRORS,
  PAYMENT_ERRORS,
  RATE_ERRORS,
} from './errors';

describe('finance i18n error keys (verbatim from the mock services)', () => {
  it('invoices', () => {
    expect(INVOICE_ERRORS.numberTaken).toBe('invoices.errors.numberTaken');
    expect(INVOICE_ERRORS.invalidTotals).toBe('invoices.validation.invalidTotals');
    expect(INVOICE_ERRORS.fileNotReady).toBe('invoices.validation.fileNotReady');
    expect(Object.keys(INVOICE_ERRORS)).toHaveLength(17);
  });

  it('billing, expenses, payments, accounts and rates', () => {
    expect(BILLING_ERRORS.rateMissing).toBe('billing.errors.rateMissing');
    expect(Object.keys(BILLING_ERRORS)).toHaveLength(6);
    expect(EXPENSE_ERRORS.rateMissing).toBe('expenses.errors.rateMissing');
    expect(Object.keys(EXPENSE_ERRORS)).toHaveLength(8);
    expect(PAYMENT_ERRORS.currencyMismatch).toBe('payments.validation.currencyMismatch');
    expect(PAYMENT_ERRORS.accountInactive).toBe('accounts.validation.inactive');
    expect(Object.keys(PAYMENT_ERRORS)).toHaveLength(6);
    expect(ACCOUNT_ERRORS.currencyLocked).toBe('accounts.validation.currencyLocked');
    expect(RATE_ERRORS.unknownCurrency).toBe('catalogs.rates.errors.unknownCurrency');
  });

  it('every key is a dotted i18n key', () => {
    const all = [
      INVOICE_ERRORS,
      BILLING_ERRORS,
      EXPENSE_ERRORS,
      PAYMENT_ERRORS,
      ACCOUNT_ERRORS,
      RATE_ERRORS,
    ];
    for (const group of all) {
      for (const key of Object.values(group)) expect(key).toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
    }
  });
});
