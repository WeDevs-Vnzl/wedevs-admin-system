/**
 * Error codes of the API error envelope (`api-contract.md` §4). Mirrors the FE `ERROR_CODE_VALUES`
 * plus `RATE_LIMITED` (throttler, DT-88).
 */
export const ERROR_CODE_VALUES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'INTEGRITY_LOCK',
  'ACCESS_KEY_INVALID',
  'ACCESS_KEY_LOCKED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

/** Default i18n key of an error code: `common.errors.<CODE>`. */
export function errorMessageKey(code: ErrorCode): string {
  return `common.errors.${code}`;
}
