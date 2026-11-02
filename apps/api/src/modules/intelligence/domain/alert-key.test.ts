import { describe, expect, it } from 'vitest';
import { ALERT_TYPE_VALUES } from './alert-type';
import { buildAlertKey, isAlertKey, parseAlertKey } from './alert-key';

describe('alert types (PRD §7.9)', () => {
  it('are exactly the nine of the table', () => {
    expect([...ALERT_TYPE_VALUES]).toEqual([
      'INVOICE_OVERDUE',
      'INVOICE_DUE_SOON',
      'INSTALLMENT_TO_INVOICE',
      'DOCUMENT_EXPIRING',
      'DOCUMENT_EXPIRED',
      'RECURRING_EXPENSE_PENDING',
      'PAYMENT_PENDING_VERIFICATION',
      'UNALLOCATED_CREDIT',
      'MISSING_RATE',
    ]);
  });
});

describe('alertKey', () => {
  it('builds and parses <TYPE>:<subject>', () => {
    expect(buildAlertKey('INVOICE_OVERDUE', 'inv_0042')).toBe('INVOICE_OVERDUE:inv_0042');
    expect(parseAlertKey('INVOICE_OVERDUE:inv_0042')).toEqual({
      type: 'INVOICE_OVERDUE',
      subject: 'inv_0042',
    });
    expect(parseAlertKey('MISSING_RATE:VES:2026-10-09')).toEqual({
      type: 'MISSING_RATE',
      subject: 'VES:2026-10-09',
    });
  });

  it('accepts valid keys and rejects malformed ones', () => {
    for (const key of [
      'INVOICE_OVERDUE:inv_1',
      'MISSING_RATE:VES:2026-10-09',
      'DOCUMENT_EXPIRED:doc_1',
    ]) {
      expect(isAlertKey(key), key).toBe(true);
    }
    for (const bad of [
      '',
      'INVOICE_OVERDUE',
      'INVOICE_OVERDUE:',
      'UNKNOWN_TYPE:x',
      'invoice_overdue:x',
      'INVOICE_OVERDUE:a b',
      `INVOICE_OVERDUE:${'x'.repeat(200)}`,
    ]) {
      expect(isAlertKey(bad), bad).toBe(false);
      expect(parseAlertKey(bad), bad).toBeNull();
    }
  });

  it('caps the whole key at 140 characters and the subject at 100', () => {
    expect(isAlertKey(`INVOICE_OVERDUE:${'x'.repeat(100)}`)).toBe(true);
    expect(isAlertKey(`INVOICE_OVERDUE:${'x'.repeat(101)}`)).toBe(false);
    expect(isAlertKey(`${'A'.repeat(130)}:x`)).toBe(false);
  });
});
