import { describe, expect, it } from 'vitest';
import { ALERT_TYPE_VALUES } from './alert-type';
import { alertGrantOf, visibleAlertTypes, type AlertGrants } from './alert-visibility';

const grants = (over: Partial<AlertGrants> = {}): AlertGrants => ({
  financials: false,
  documents: false,
  settings: false,
  ...over,
});

describe('alertGrantOf', () => {
  it('maps the six finance types to financials, the two document types to documents, the rate to settings', () => {
    expect(ALERT_TYPE_VALUES.map((type) => [type, alertGrantOf(type)])).toEqual([
      ['INVOICE_OVERDUE', 'financials'],
      ['INVOICE_DUE_SOON', 'financials'],
      ['INSTALLMENT_TO_INVOICE', 'financials'],
      ['DOCUMENT_EXPIRING', 'documents'],
      ['DOCUMENT_EXPIRED', 'documents'],
      ['RECURRING_EXPENSE_PENDING', 'financials'],
      ['PAYMENT_PENDING_VERIFICATION', 'financials'],
      ['UNALLOCATED_CREDIT', 'financials'],
      ['MISSING_RATE', 'settings'],
    ]);
  });
});

describe('visibleAlertTypes', () => {
  it('Owner or Admin sees all nine', () => {
    expect(
      visibleAlertTypes(grants({ financials: true, documents: true, settings: true })),
    ).toEqual([...ALERT_TYPE_VALUES]);
  });

  it('Member or Viewer keep documents, no finance and no rate', () => {
    expect(visibleAlertTypes(grants({ documents: true }))).toEqual([
      'DOCUMENT_EXPIRING',
      'DOCUMENT_EXPIRED',
    ]);
  });

  it('sees nothing without any grant', () => {
    expect(visibleAlertTypes(grants())).toEqual([]);
  });

  it('settings alone shows only the rate alert', () => {
    expect(visibleAlertTypes(grants({ settings: true }))).toEqual(['MISSING_RATE']);
  });
});
