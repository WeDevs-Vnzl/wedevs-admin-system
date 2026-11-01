import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import type { MoneyString } from '../../../../../shared/domain/money';
import { parseAlertKey } from '../../../domain/alert-key';
import { ALERT_TYPE_VALUES, type AlertType } from '../../../domain/alert-type';

// The vocabulary of the alert inputs, for the interface layer (it cannot reach the domain directly).
export {
  ALERT_DEFAULT_LIMIT,
  ALERT_MAX_LIMIT,
  ALERT_MAX_MARK_READ,
  ALERT_MAX_SNOOZE_DAYS,
  ALERT_TYPE_VALUES,
  type AlertType,
} from '../../../domain/alert-type';
import { visibleAlertTypes } from '../../../domain/alert-visibility';

/** One live alert, as the bell and the panels show it. */
export interface AlertOutput {
  readonly alertKey: string;
  readonly type: AlertType;
  readonly entity: EntityRef | null;
  readonly date: string | null;
  readonly days: number | null;
  readonly amount: { readonly amount: MoneyString; readonly currency: string } | null;
  readonly context: string | null;
}

export function invalid(field: string, key: string): ValidationFailedError {
  const fieldErrors: FieldErrors = { [field]: [key] };
  return new ValidationFailedError({ message: key, fieldErrors });
}

/**
 * Alert types the caller may see (DT-79: the route is `@Authenticated()`, the use case decides by data):
 * finance types by `canSeeFinancials`, documents by `read document`, the rate by `read settings`.
 */
export function visibleTypesOf(authorization: AuthorizationPort, user: CurrentUser): AlertType[] {
  return visibleAlertTypes({
    financials: authorization.canSeeFinancials(user),
    documents: authorization.can(user, 'read', 'document'),
    settings: authorization.can(user, 'read', 'settings'),
  });
}

/**
 * A8: the key's format and type are validated and the type must be visible to the caller (else `NOT_FOUND`,
 * C14). The subject is not resolved: the alert may already be gone, and the state row is the caller's own.
 */
export function assertKeyVisible(
  authorization: AuthorizationPort,
  user: CurrentUser,
  alertKey: string,
): void {
  const parsed = parseAlertKey(alertKey);
  if (parsed === null) throw invalid('alertKey', 'alerts.validation.alertKey');
  if (!visibleTypesOf(authorization, user).includes(parsed.type)) throw new NotFoundError();
}

/** Narrowing `types` of the query: well-formed, without repeats; an unknown type is `VALIDATION`. */
export function parseTypesFilter(types: readonly string[] | undefined): AlertType[] | null {
  if (types === undefined || types.length === 0) return null;
  const known = new Set<AlertType>();
  for (const value of types) {
    const type = ALERT_TYPE_VALUES.find((candidate) => candidate === value);
    if (type === undefined) throw invalid('types', 'alerts.validation.types');
    known.add(type);
  }
  return [...known];
}
