import { ALERT_TYPE_VALUES, type AlertType } from './alert-type';

/**
 * Stable identity of an alert across recomputations: `<TYPE>:<subject>`, the entity id for entity alerts
 * (`INVOICE_OVERDUE:inv_0042`) and `VES:<YYYY-MM-DD>` for `MISSING_RATE`. Dismissals and snoozes attach to it.
 */
const ALERT_KEY_PATTERN = /^([A-Z_]+):([A-Za-z0-9_:-]{1,100})$/;
const ALERT_KEY_MAX_LENGTH = 140;

export function buildAlertKey(type: AlertType, subject: string): string {
  return `${type}:${subject}`;
}

/** Splits an alert key; `null` when it is not `<known TYPE>:<subject>`. */
export function parseAlertKey(key: string): { type: AlertType; subject: string } | null {
  if (key.length > ALERT_KEY_MAX_LENGTH) return null;
  const match = ALERT_KEY_PATTERN.exec(key);
  const type = match?.[1];
  const subject = match?.[2];
  if (type === undefined || subject === undefined) return null;
  const known = ALERT_TYPE_VALUES.find((value) => value === type);
  return known === undefined ? null : { type: known, subject };
}

export function isAlertKey(key: string): boolean {
  return parseAlertKey(key) !== null;
}
