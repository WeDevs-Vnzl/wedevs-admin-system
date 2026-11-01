/** The nine alert types of PRD §7.9, in the order of the table. */
export const ALERT_TYPE_VALUES = [
  'INVOICE_OVERDUE',
  'INVOICE_DUE_SOON',
  'INSTALLMENT_TO_INVOICE',
  'DOCUMENT_EXPIRING',
  'DOCUMENT_EXPIRED',
  'RECURRING_EXPENSE_PENDING',
  'PAYMENT_PENDING_VERIFICATION',
  'UNALLOCATED_CREDIT',
  'MISSING_RATE',
] as const;
export type AlertType = (typeof ALERT_TYPE_VALUES)[number];

export const ALERT_DEFAULT_LIMIT = 50;
export const ALERT_MAX_LIMIT = 200;
export const ALERT_MAX_SNOOZE_DAYS = 90;
export const ALERT_MAX_MARK_READ = 200;
