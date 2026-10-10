import {
  ACTIVITY_CHANGED_MARKER,
  type ActivityChanges,
  type ActivityDiffValue,
} from "@/lib/validators/activity";

/**
 * Per-field diff for the activity log (PRD §8.14, C12). Pure and framework-free, so the Hito 1 mock
 * services and the Hito 2 services (H2-B3) build `changes` the same way.
 */

export interface DiffFieldsOptions {
  /** Fields to compare, in the order they appear in the result. */
  fields: readonly string[];
  /** Long texts (descriptions, notes): only the fact that they changed is recorded (`"changed"`). */
  longText?: readonly string[] | undefined;
  /** Sensitive fields: never compared, never present in the result, even when listed in `fields`. */
  exclude?: readonly string[] | undefined;
}

/**
 * Normalizes a value into what a diff may carry: a string, a boolean or `null`. Money and numbers are
 * serialized as strings (C15): a decimal string stays verbatim and a JS number is stringified, never kept
 * as a number. Dates become ISO strings; anything structured is stored as its JSON text.
 */
function toDiffValue(value: unknown): ActivityDiffValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * Compares `before` and `after` over `options.fields` and returns `{ field: [before, after] }` for the
 * fields that changed (`"changed"` for long texts), or `undefined` when nothing did.
 */
export function diffFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  options: DiffFieldsOptions,
): ActivityChanges | undefined {
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

  return Object.keys(changes).length > 0 ? changes : undefined;
}
