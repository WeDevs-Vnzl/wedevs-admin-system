/**
 * Per-field change set for the activity log (PRD §8.14, C12, C20). Pure; the field labels are rendered
 * by the activity feed (BE-2), not here.
 */

/** Marker for a long text whose content is not recorded: only that it changed. */
export const ACTIVITY_CHANGED_MARKER = 'changed' as const;

export type ActivityDiffValue = string | boolean | null;
/** `[before, after]`, or the marker for long texts. */
export type ActivityChange = readonly [ActivityDiffValue, ActivityDiffValue] | 'changed';
export type ActivityChanges = Record<string, ActivityChange>;

export interface DiffFieldsOptions {
  /** Fields to compare, in the order they appear in the result. */
  readonly fields: readonly string[];
  /** Long texts (descriptions, notes): only the fact that they changed is recorded. */
  readonly longText?: readonly string[] | undefined;
  /** Sensitive fields: never compared, never present in the result, even when listed in `fields`. */
  readonly exclude?: readonly string[] | undefined;
}

/**
 * Normalizes a value into what a diff may carry: a string, a boolean or `null`. Money and numbers are
 * serialized as strings (C15), dates as ISO strings and anything structured as its JSON text.
 */
function toDiffValue(value: unknown): ActivityDiffValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * Compares `before` and `after` over `options.fields` and returns `{ field: [before, after] }` for the
 * fields that changed (the marker for long texts), or `null` when nothing did.
 */
export function diffFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  options: DiffFieldsOptions,
): ActivityChanges | null {
  const excluded = new Set(options.exclude ?? []);
  const long = new Set(options.longText ?? []);
  const changes: ActivityChanges = {};

  for (const field of options.fields) {
    if (excluded.has(field)) continue;
    const previous = toDiffValue(before[field]);
    const next = toDiffValue(after[field]);
    if (previous === next) continue;
    changes[field] = long.has(field) ? ACTIVITY_CHANGED_MARKER : [previous, next];
  }

  return Object.keys(changes).length > 0 ? changes : null;
}
