import { ALERT_TYPE_VALUES, type AlertType } from './alert-type';

/** What the caller may see, resolved by the use case from `can()` and `canSeeFinancials`. */
export type AlertGrants = {
  /** Owner and Admin (`canSeeFinancials`). */
  financials: boolean;
  /** `read` on `document`. */
  documents: boolean;
  /** `read` on `settings`. */
  settings: boolean;
};
export type AlertGrant = keyof AlertGrants;

const DOCUMENT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  'DOCUMENT_EXPIRING',
  'DOCUMENT_EXPIRED',
]);
const SETTINGS_TYPES: ReadonlySet<AlertType> = new Set<AlertType>(['MISSING_RATE']);

/** The grant an alert type needs: finance types need financials, documents by `read`, the rate by settings. */
export function alertGrantOf(type: AlertType): AlertGrant {
  if (DOCUMENT_TYPES.has(type)) return 'documents';
  if (SETTINGS_TYPES.has(type)) return 'settings';
  return 'financials';
}

/** Alert types the caller may see, in the order of the table. */
export function visibleAlertTypes(grants: AlertGrants): AlertType[] {
  return ALERT_TYPE_VALUES.filter((type) => grants[alertGrantOf(type)]);
}
