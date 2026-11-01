import { ValidationFailedError } from '../../../shared/domain/domain-error';
import { isAlertKey } from './alert-key';
import {
  ALERT_DEFAULT_LIMIT,
  ALERT_MAX_LIMIT,
  ALERT_MAX_MARK_READ,
  ALERT_MAX_SNOOZE_DAYS,
} from './alert-type';

const DAY_MS = 86_400_000;

/** The caller's own `AlertState` row, as far as hiding is concerned (DT-163). */
export type AlertHiding = { dismissedAt: Date | null; dismissedUntil: Date | null };

export type AlertDismissalView = {
  alertKey: string;
  /** `null` = dismissed for good (or not hidden); an ISO instant = snoozed until then. */
  dismissedUntil: string | null;
  active: boolean;
};

/** Hidden: dismissed for good, or snoozed past `now`. A row with neither only marks as read. */
export function isAlertHidden(state: AlertHiding, now: Date): boolean {
  if (state.dismissedAt !== null) return true;
  return state.dismissedUntil !== null && state.dismissedUntil.getTime() > now.getTime();
}

/** Maps a state row (or none) to the DTO of dismiss, snooze and restore. */
export function toDismissalView(
  alertKey: string,
  state: AlertHiding | null,
  now: Date,
): AlertDismissalView {
  if (state === null || !isAlertHidden(state, now)) {
    return { alertKey, dismissedUntil: null, active: true };
  }
  return {
    alertKey,
    dismissedUntil:
      state.dismissedAt !== null ? null : (state.dismissedUntil?.toISOString() ?? null),
    active: false,
  };
}

function invalid(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ message: key, fieldErrors: { [field]: [key] } });
}

export function assertSnoozeDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > ALERT_MAX_SNOOZE_DAYS) {
    throw invalid('days', 'alerts.validation.snoozeDays');
  }
}

/** The instant a snooze of `days` days ends. */
export function snoozeUntil(now: Date, days: number): Date {
  assertSnoozeDays(days);
  return new Date(now.getTime() + days * DAY_MS);
}

/** Page size of the inbox: 50 by default, 1 to 200. */
export function alertLimit(limit: number | undefined): number {
  if (limit === undefined) return ALERT_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > ALERT_MAX_LIMIT) {
    throw invalid('limit', 'alerts.validation.limit');
  }
  return limit;
}

/** One to 200 well-formed keys; returns them without repeats. */
export function assertMarkReadKeys(keys: readonly string[]): string[] {
  if (keys.length < 1 || keys.length > ALERT_MAX_MARK_READ || !keys.every(isAlertKey)) {
    throw invalid('alertKeys', 'alerts.validation.alertKeys');
  }
  return [...new Set(keys)];
}
