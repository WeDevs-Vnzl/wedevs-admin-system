import type { FieldErrors } from '../../../shared/domain/domain-error';

/**
 * Field checks shared by the client and contact forms. Ported from the primitives of
 * `fe/src/lib/validators/{common,tags,contacts}.ts` (`requiredText`, `optionalText`,
 * `optionalEmailSchema`, `optionalHttpUrlSchema`, `e164PhoneSchema`, `uniqueIds`). Each check writes its
 * i18n key (never prose) into `errors` under the field name and returns the normalized value.
 */

export const FIELD_KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
  invalidEmail: 'validation.invalidEmail',
  invalidOption: 'validation.invalidOption',
} as const;

/** E.164: `+` and 7 to 15 digits, the first not `0` (`+584121234567`). */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
export const EMAIL_MAX_LENGTH = 254;
export const URL_MAX_LENGTH = 2048;
export const TAG_IDS_MAX = 50;

/** The e-mail grammar of Zod's `z.email()`, which the FE validators use. */
const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export function isE164Phone(value: string): boolean {
  return E164_PATTERN.test(value);
}

export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/** `http:` / `https:` URL with a host. Rejects `javascript:`, `data:`, `file:` and friends (C4). */
export function isHttpUrl(value: string): boolean {
  if (value.length > URL_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** Required text: trimmed, non-empty, at most `max` characters. */
export function requiredText(errors: FieldErrors, field: string, raw: string, max: number): string {
  const value = raw.trim();
  if (value.length === 0) errors[field] = [FIELD_KEYS.required];
  else if (value.length > max) errors[field] = [FIELD_KEYS.tooLong];
  return value;
}

/** Optional text: trimmed; blank or missing is `null`. */
export function optionalText(
  errors: FieldErrors,
  field: string,
  raw: string | null | undefined,
  max: number,
): string | null {
  const value = (raw ?? '').trim();
  if (value.length > max) errors[field] = [FIELD_KEYS.tooLong];
  return value.length > 0 ? value : null;
}

export function optionalEmail(
  errors: FieldErrors,
  field: string,
  raw: string | null | undefined,
): string | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;
  if (value.length > EMAIL_MAX_LENGTH) errors[field] = [FIELD_KEYS.tooLong];
  else if (!isEmail(value)) errors[field] = [FIELD_KEYS.invalidEmail];
  return value;
}

export function optionalHttpUrl(
  errors: FieldErrors,
  field: string,
  raw: string | null | undefined,
): string | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;
  if (!isHttpUrl(value)) errors[field] = [FIELD_KEYS.invalidFormat];
  return value;
}

/** A list of tag ids: at most 50, no repeats. */
export function tagIdList(
  errors: FieldErrors,
  field: string,
  raw: readonly string[] | undefined,
): string[] {
  const ids = [...(raw ?? [])];
  if (ids.length > TAG_IDS_MAX) errors[field] = [FIELD_KEYS.tooLong];
  else if (new Set(ids).size !== ids.length) errors[field] = [FIELD_KEYS.invalidOption];
  return ids;
}

const tagCollator = new Intl.Collator('es', { sensitivity: 'base' });

/**
 * The readable tag snapshot an activity diff records (C1, CR-B4): the tag names, sorted in Spanish order
 * and joined with `", "`. Ids never reach the log.
 */
export function tagNamesSnapshot(names: readonly string[]): string {
  return [...names].sort((a, b) => tagCollator.compare(a, b)).join(', ');
}

/** Compact tag shown as a chip; structurally the settings context's `TagChip`. */
export interface TagChipView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}
