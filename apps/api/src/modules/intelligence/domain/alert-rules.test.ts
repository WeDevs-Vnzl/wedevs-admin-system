import { describe, expect, it } from 'vitest';
import { addDays } from '../../../shared/domain/business-date';
import {
  documentExpiredAlert,
  documentExpiringAlert,
  installmentToInvoiceAlert,
  invoiceDueSoonAlert,
  invoiceOverdueAlert,
  missingRateAlert,
  paymentPendingVerificationAlert,
  recurringExpensePendingAlert,
  unallocatedCreditAlert,
} from './alert-rules';

const TODAY = '2026-10-09'; // Friday
const off = (days: number) => addDays(TODAY, days);

describe('invoice overdue', () => {
  const base = { archived: false, isDraft: false, status: 'VENCIDA', dueDate: off(-10) };

  it('VENCIDA only, with days since the due date', () => {
    expect(invoiceOverdueAlert(base, TODAY)).toEqual({ date: off(-10), days: -10 });
    expect(invoiceOverdueAlert({ ...base, status: 'EMITIDA' }, TODAY)).toBeNull();
  });

  it('never drafts nor archived invoices', () => {
    expect(invoiceOverdueAlert({ ...base, isDraft: true }, TODAY)).toBeNull();
    expect(invoiceOverdueAlert({ ...base, archived: true }, TODAY)).toBeNull();
  });
});

describe('invoice due soon', () => {
  const base = { archived: false, isDraft: false, status: 'EMITIDA', balance: '100.00' };

  it('day 7 yes, day 8 no, today yes, yesterday no', () => {
    expect(invoiceDueSoonAlert({ ...base, dueDate: off(7) }, TODAY)).toEqual({
      date: off(7),
      days: 7,
    });
    expect(invoiceDueSoonAlert({ ...base, dueDate: off(8) }, TODAY)).toBeNull();
    expect(invoiceDueSoonAlert({ ...base, dueDate: off(0) }, TODAY)).toEqual({
      date: off(0),
      days: 0,
    });
    expect(invoiceDueSoonAlert({ ...base, dueDate: off(-1) }, TODAY)).toBeNull();
  });

  it('balance 0.00 no, 0.01 yes', () => {
    expect(invoiceDueSoonAlert({ ...base, dueDate: off(3), balance: '0.00' }, TODAY)).toBeNull();
    expect(
      invoiceDueSoonAlert({ ...base, dueDate: off(3), balance: '0.01' }, TODAY),
    ).not.toBeNull();
  });

  it('EMITIDA and PARCIAL only; paid, drafts and archived are out', () => {
    expect(
      invoiceDueSoonAlert({ ...base, status: 'PARCIAL', dueDate: off(3) }, TODAY),
    ).not.toBeNull();
    expect(invoiceDueSoonAlert({ ...base, status: 'PAGADA', dueDate: off(3) }, TODAY)).toBeNull();
    expect(invoiceDueSoonAlert({ ...base, isDraft: true, dueDate: off(3) }, TODAY)).toBeNull();
    expect(invoiceDueSoonAlert({ ...base, archived: true, dueDate: off(3) }, TODAY)).toBeNull();
  });
});

describe('installment to invoice', () => {
  const base = { status: 'PENDIENTE' };

  it('PENDIENTE due in 7 days or past; day 8 is out', () => {
    expect(installmentToInvoiceAlert({ ...base, dueDate: off(7) }, TODAY)).toEqual({
      date: off(7),
      days: 7,
    });
    expect(installmentToInvoiceAlert({ ...base, dueDate: off(8) }, TODAY)).toBeNull();
    expect(installmentToInvoiceAlert({ ...base, dueDate: off(-4) }, TODAY)).toEqual({
      date: off(-4),
      days: -4,
    });
  });

  it('no due date or a billed or cancelled installment is out', () => {
    expect(installmentToInvoiceAlert({ ...base, dueDate: null }, TODAY)).toBeNull();
    expect(installmentToInvoiceAlert({ status: 'FACTURADA', dueDate: off(1) }, TODAY)).toBeNull();
    expect(installmentToInvoiceAlert({ status: 'CANCELADA', dueDate: off(1) }, TODAY)).toBeNull();
  });
});

describe('document expiring', () => {
  const base = { archived: false, status: 'VIGENTE', alertDaysBefore: 30 as number | null };

  it('inside alertDaysBefore inclusive; 31 days out', () => {
    expect(documentExpiringAlert({ ...base, expiresAt: off(30) }, TODAY)).toEqual({
      date: off(30),
      days: 30,
    });
    expect(documentExpiringAlert({ ...base, expiresAt: off(31) }, TODAY)).toBeNull();
    expect(
      documentExpiringAlert({ ...base, expiresAt: off(31), alertDaysBefore: 45 }, TODAY),
    ).not.toBeNull();
  });

  it('a null window defaults to 30', () => {
    expect(
      documentExpiringAlert({ ...base, alertDaysBefore: null, expiresAt: off(30) }, TODAY),
    ).not.toBeNull();
    expect(
      documentExpiringAlert({ ...base, alertDaysBefore: null, expiresAt: off(31) }, TODAY),
    ).toBeNull();
  });

  it('already past, no expiry, VENCIDO, ANULADO and archived are out', () => {
    expect(documentExpiringAlert({ ...base, expiresAt: off(-1) }, TODAY)).toBeNull();
    expect(documentExpiringAlert({ ...base, expiresAt: null }, TODAY)).toBeNull();
    expect(
      documentExpiringAlert({ ...base, status: 'VENCIDO', expiresAt: off(5) }, TODAY),
    ).toBeNull();
    expect(
      documentExpiringAlert({ ...base, status: 'ANULADO', expiresAt: off(5) }, TODAY),
    ).toBeNull();
    expect(documentExpiringAlert({ ...base, archived: true, expiresAt: off(5) }, TODAY)).toBeNull();
  });
});

describe('document expired', () => {
  it('VENCIDO, with days since expiry or null without a date', () => {
    expect(
      documentExpiredAlert({ archived: false, status: 'VENCIDO', expiresAt: off(-3) }, TODAY),
    ).toEqual({ date: off(-3), days: -3 });
    expect(
      documentExpiredAlert({ archived: false, status: 'VENCIDO', expiresAt: null }, TODAY),
    ).toEqual({ date: null, days: null });
  });

  it('other statuses and archived documents are out', () => {
    expect(
      documentExpiredAlert({ archived: false, status: 'VIGENTE', expiresAt: off(-3) }, TODAY),
    ).toBeNull();
    expect(
      documentExpiredAlert({ archived: true, status: 'VENCIDO', expiresAt: off(-3) }, TODAY),
    ).toBeNull();
  });
});

describe('recurring expense pending', () => {
  const base = { recurring: true, status: 'PENDIENTE' };

  it('due in 5 days or past; day 6 is out', () => {
    expect(recurringExpensePendingAlert({ ...base, dueDate: off(5) }, TODAY)).toEqual({
      date: off(5),
      days: 5,
    });
    expect(recurringExpensePendingAlert({ ...base, dueDate: off(6) }, TODAY)).toBeNull();
    expect(recurringExpensePendingAlert({ ...base, dueDate: off(-2) }, TODAY)).toEqual({
      date: off(-2),
      days: -2,
    });
  });

  it('manual, paid and undated expenses are out', () => {
    expect(
      recurringExpensePendingAlert({ ...base, recurring: false, dueDate: off(1) }, TODAY),
    ).toBeNull();
    expect(
      recurringExpensePendingAlert({ ...base, status: 'PAGADO', dueDate: off(1) }, TODAY),
    ).toBeNull();
    expect(recurringExpensePendingAlert({ ...base, dueDate: null }, TODAY)).toBeNull();
  });
});

describe('payment pending verification (age from Payment.date, never createdAt)', () => {
  const base = { status: 'PENDIENTE_VERIFICACION' };

  it('age 2 out, 3 in with negative days', () => {
    expect(paymentPendingVerificationAlert({ ...base, date: off(-2) }, TODAY)).toBeNull();
    expect(paymentPendingVerificationAlert({ ...base, date: off(-3) }, TODAY)).toEqual({
      date: off(-3),
      days: -3,
    });
  });

  it('a future-dated payment is out', () => {
    expect(paymentPendingVerificationAlert({ ...base, date: off(5) }, TODAY)).toBeNull();
  });

  it('only PENDIENTE_VERIFICACION counts', () => {
    expect(
      paymentPendingVerificationAlert({ status: 'CONFIRMADO', date: off(-10) }, TODAY),
    ).toBeNull();
  });
});

describe('unallocated credit (age from Payment.date)', () => {
  const base = { status: 'CONFIRMADO', unallocated: '50.00' };

  it('age 15 out, 16 in', () => {
    expect(unallocatedCreditAlert({ ...base, date: off(-15) }, TODAY)).toBeNull();
    expect(unallocatedCreditAlert({ ...base, date: off(-16) }, TODAY)).toEqual({
      date: off(-16),
      days: -16,
    });
  });

  it('a future-dated payment is out', () => {
    expect(unallocatedCreditAlert({ ...base, date: off(3) }, TODAY)).toBeNull();
  });

  it('unallocated 0.00 no, 0.01 yes; pending payments out', () => {
    expect(
      unallocatedCreditAlert({ ...base, unallocated: '0.00', date: off(-20) }, TODAY),
    ).toBeNull();
    expect(
      unallocatedCreditAlert({ ...base, unallocated: '0.01', date: off(-20) }, TODAY),
    ).not.toBeNull();
    expect(
      unallocatedCreditAlert(
        { status: 'PENDIENTE_VERIFICACION', unallocated: '50.00', date: off(-20) },
        TODAY,
      ),
    ).toBeNull();
  });
});

describe('missing rate', () => {
  it('a business day without a VES rate alerts with subject VES:<day>', () => {
    expect(missingRateAlert({ hasRateToday: false }, TODAY)).toEqual({
      date: TODAY,
      days: 0,
      subject: `VES:${TODAY}`,
    });
  });

  it('with a rate it does not', () => {
    expect(missingRateAlert({ hasRateToday: true }, TODAY)).toBeNull();
  });

  it('on a weekend it does not', () => {
    expect(missingRateAlert({ hasRateToday: false }, '2026-10-10')).toBeNull();
    expect(missingRateAlert({ hasRateToday: false }, '2026-10-11')).toBeNull();
    expect(missingRateAlert({ hasRateToday: false }, '2026-10-12')).not.toBeNull();
  });
});
