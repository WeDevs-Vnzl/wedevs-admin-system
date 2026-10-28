/**
 * Per-user preferences (PRD §7.3, §7.8, §8.15; DT-43). Stored as `UserPreference` rows
 * `{ userId, key, value: Json }`; the allowed keys are `locale`, `theme`, `timezone` and
 * `table:<tableId>:columns`. Ported from `fe/src/lib/validators/preferences.ts` without a schema library
 * (the domain imports none); messages are i18n keys.
 */

export const PREFERENCE_MESSAGES = {
  required: 'validation.required',
  invalidFormat: 'validation.invalidFormat',
  invalidOption: 'validation.invalidOption',
} as const;

export const LOCALE_VALUES = ['es', 'en'] as const;
export type Locale = (typeof LOCALE_VALUES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

export const THEME_VALUES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEME_VALUES)[number];
export const DEFAULT_THEME: Theme = 'system';

/** Business time zone; also the default display zone of every user. */
export const DEFAULT_TIMEZONE = 'America/Caracas';

/** A real IANA time zone (`America/Caracas`, `UTC`...), checked with `Intl`. */
export function isValidTimezone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const TABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COLUMN_ID = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const TABLE_COLUMNS_KEY = /^table:([a-z][a-z0-9]*(?:-[a-z0-9]+)*):columns$/;
const MAX_TABLE_ID = 40;
const MAX_KEY = 54;

/** Stable id of a table (`clients`, `project-links`...): lower-case kebab. */
export function isValidTableId(value: string): boolean {
  return value.length <= MAX_TABLE_ID && TABLE_ID.test(value);
}

/** `UserPreference.key` of a table's column configuration. */
export function tableColumnsKey(tableId: string): string {
  return `table:${tableId}:columns`;
}

/** Extracts `<tableId>` from a `table:<tableId>:columns` key; `null` when it is not one. */
export function parseTableColumnsKey(key: string): string | null {
  const tableId = TABLE_COLUMNS_KEY.exec(key)?.[1];
  return tableId !== undefined && isValidTableId(tableId) ? tableId : null;
}

/** Width range (px) a column can be given. */
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 1200;
const MAX_COLUMNS = 60;

export const SIMPLE_PREFERENCE_KEYS = ['locale', 'theme', 'timezone'] as const;

export type PreferenceKey = 'locale' | 'theme' | 'timezone' | `table:${string}:columns`;

/** Whether `key` is one of the four key families. */
export function isValidPreferenceKey(key: string): key is PreferenceKey {
  if ((SIMPLE_PREFERENCE_KEYS as readonly string[]).includes(key)) return true;
  return key.length <= MAX_KEY && parseTableColumnsKey(key) !== null;
}

/** Value of a `table:<id>:columns` preference. */
export interface TableColumnsPreference {
  readonly order: string[];
  readonly visibility: Record<string, boolean>;
  readonly widths: Record<string, number>;
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validColumnId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && COLUMN_ID.test(value);
}

/**
 * Parses a `table:<id>:columns` value, filling the defaults (`order: []`, `visibility: {}`, `widths: {}`).
 * Columns absent from `order` keep their default position; absent from `visibility`, their visibility.
 */
export function parseTableColumnsPreference(value: unknown): Parsed<TableColumnsPreference> {
  if (!isPlainObject(value)) return { ok: false };

  const rawOrder = value.order ?? [];
  if (!Array.isArray(rawOrder) || rawOrder.length > MAX_COLUMNS) return { ok: false };
  if (!rawOrder.every(validColumnId)) return { ok: false };
  const order = rawOrder as string[];
  if (new Set(order).size !== order.length) return { ok: false };

  const rawVisibility = value.visibility ?? {};
  if (!isPlainObject(rawVisibility)) return { ok: false };
  const visibility: Record<string, boolean> = {};
  for (const [column, visible] of Object.entries(rawVisibility)) {
    if (!validColumnId(column) || typeof visible !== 'boolean') return { ok: false };
    visibility[column] = visible;
  }

  const rawWidths = value.widths ?? {};
  if (!isPlainObject(rawWidths)) return { ok: false };
  const widths: Record<string, number> = {};
  for (const [column, width] of Object.entries(rawWidths)) {
    if (
      !validColumnId(column) ||
      typeof width !== 'number' ||
      !Number.isInteger(width) ||
      width < MIN_COLUMN_WIDTH ||
      width > MAX_COLUMN_WIDTH
    ) {
      return { ok: false };
    }
    widths[column] = width;
  }

  return { ok: true, value: { order: [...order], visibility, widths } };
}

function parseEnum<T extends string>(values: readonly T[], value: unknown): Parsed<T> {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? { ok: true, value: value as T }
    : { ok: false };
}

export function parseLocale(value: unknown): Parsed<Locale> {
  return parseEnum(LOCALE_VALUES, value);
}

export function parseTheme(value: unknown): Parsed<Theme> {
  return parseEnum(THEME_VALUES, value);
}

export function parseTimezone(value: unknown): Parsed<string> {
  return typeof value === 'string' && isValidTimezone(value) ? { ok: true, value } : { ok: false };
}

/** A validated `{ key, value }` pair ready to be stored. */
export interface PreferenceEntry {
  readonly key: PreferenceKey;
  readonly value: unknown;
}

export type PreferenceInputResult =
  | { readonly ok: true; readonly entry: PreferenceEntry }
  | { readonly ok: false; readonly fieldErrors: Record<string, string[]> };

/** Validates the value a key accepts (`setPreference`); failures are keyed by `key` or `value`. */
export function parsePreferenceInput(key: string, value: unknown): PreferenceInputResult {
  if (!isValidPreferenceKey(key)) {
    return { ok: false, fieldErrors: { key: [PREFERENCE_MESSAGES.invalidFormat] } };
  }
  let parsed: Parsed<unknown>;
  if (key === 'locale') parsed = parseLocale(value);
  else if (key === 'theme') parsed = parseTheme(value);
  else if (key === 'timezone') parsed = parseTimezone(value);
  else parsed = parseTableColumnsPreference(value);
  if (!parsed.ok) {
    return { ok: false, fieldErrors: { value: [PREFERENCE_MESSAGES.invalidOption] } };
  }
  return { ok: true, entry: { key, value: parsed.value } };
}

/** The user's effective preferences (`GET /me/preferences`). */
export interface UserPreferences {
  locale: Locale;
  theme: Theme;
  timezone: string;
  /** `tableId` -> stored column configuration; tables without an entry use their defaults. */
  tableColumns: Record<string, TableColumnsPreference>;
}

export interface StoredPreference {
  readonly key: string;
  readonly value: unknown;
}

/**
 * Builds the effective preferences: keys never stored fall back to the user row (`locale`, `theme`), then to
 * the defaults. Stored values are re-validated on read, so a corrupted row never reaches the client.
 */
export function buildPreferences(
  fallback: { readonly locale?: unknown; readonly theme?: unknown },
  rows: readonly StoredPreference[],
): UserPreferences {
  const locale = parseLocale(fallback.locale);
  const theme = parseTheme(fallback.theme);
  const preferences: UserPreferences = {
    locale: locale.ok ? locale.value : DEFAULT_LOCALE,
    theme: theme.ok ? theme.value : DEFAULT_THEME,
    timezone: DEFAULT_TIMEZONE,
    tableColumns: {},
  };
  for (const row of rows) {
    if (row.key === 'locale') {
      const parsed = parseLocale(row.value);
      if (parsed.ok) preferences.locale = parsed.value;
    } else if (row.key === 'theme') {
      const parsed = parseTheme(row.value);
      if (parsed.ok) preferences.theme = parsed.value;
    } else if (row.key === 'timezone') {
      const parsed = parseTimezone(row.value);
      if (parsed.ok) preferences.timezone = parsed.value;
    } else {
      const tableId = parseTableColumnsKey(row.key);
      const parsed = parseTableColumnsPreference(row.value);
      if (tableId !== null && parsed.ok) preferences.tableColumns[tableId] = parsed.value;
    }
  }
  return preferences;
}
