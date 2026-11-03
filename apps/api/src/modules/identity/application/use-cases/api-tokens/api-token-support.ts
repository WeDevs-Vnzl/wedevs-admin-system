import type { ApiTokenRecord } from '../../ports/api-token.repository.port';

/** i18n keys of the personal access token errors and field errors. */
export const API_TOKEN_ERROR_KEYS = {
  limitReached: 'settings.apiTokens.errors.limitReached',
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  outOfRange: 'validation.outOfRange',
} as const;

export const API_TOKEN_NAME_MAX_LENGTH = 80;
export const API_TOKEN_MAX_ACTIVE = 10;
export const API_TOKEN_DEFAULT_DAYS = 90;
export const API_TOKEN_MIN_DAYS = 1;
export const API_TOKEN_MAX_DAYS = 365;
export const DAY_MS = 86_400_000;

/** What a listing exposes of a token: never the secret nor its hash. */
export interface ApiTokenOutput {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

export function toApiTokenOutput(row: ApiTokenRecord): ApiTokenOutput {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export type ParsedIssueInput =
  | { readonly ok: true; readonly name: string; readonly expiresInDays: number }
  | { readonly ok: false; readonly fieldErrors: Record<string, string[]> };

export function parseIssueInput(input: {
  readonly name: string;
  readonly expiresInDays?: number | undefined;
}): ParsedIssueInput {
  const fieldErrors: Record<string, string[]> = {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0) fieldErrors.name = [API_TOKEN_ERROR_KEYS.required];
  else if (name.length > API_TOKEN_NAME_MAX_LENGTH)
    fieldErrors.name = [API_TOKEN_ERROR_KEYS.tooLong];
  const days = input.expiresInDays ?? API_TOKEN_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < API_TOKEN_MIN_DAYS || days > API_TOKEN_MAX_DAYS) {
    fieldErrors.expiresInDays = [API_TOKEN_ERROR_KEYS.outOfRange];
  }
  return Object.keys(fieldErrors).length > 0
    ? { ok: false, fieldErrors }
    : { ok: true, name, expiresInDays: days };
}
