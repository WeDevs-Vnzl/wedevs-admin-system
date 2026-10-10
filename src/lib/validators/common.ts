import { z } from "zod";
import { entityTypeSchema } from "./enums";

/**
 * Shared contract primitives (C8, C10): action results, error codes, ids, date-only strings, list
 * queries and pagination. Pure and framework-free: no `next/*`, `react`, `next-intl` or `@clerk/*`.
 */

// ───────────────────────────── Validation message keys ─────────────────────────────

/**
 * i18n keys (namespace `validation`) used as Zod error messages (C1). Schemas never carry prose; the UI
 * translates the key at render time. Shared by `common`, `money` and `files` validators.
 */
export const VALIDATION_MESSAGES = {
  required: "validation.required",
  invalidId: "validation.id.invalid",
  invalidDate: "validation.date.invalid",
  invalidSort: "validation.sort.invalid",
  invalidMoney: "validation.money.invalid",
  moneyTooManyDecimals: "validation.money.tooManyDecimals",
  moneyOutOfRange: "validation.money.outOfRange",
  moneyMustBePositive: "validation.money.mustBePositive",
  moneyMustBeNonNegative: "validation.money.mustBeNonNegative",
  invalidRate: "validation.rate.invalid",
  rateTooManyDecimals: "validation.rate.tooManyDecimals",
  rateMustBePositive: "validation.rate.mustBePositive",
  rateOutOfRange: "validation.rate.outOfRange",
  invalidPercent: "validation.percent.invalid",
  percentTooManyDecimals: "validation.percent.tooManyDecimals",
  percentOutOfRange: "validation.percent.outOfRange",
  invalidCurrency: "validation.currency.invalid",
  fileNameInvalid: "validation.file.nameInvalid",
  fileTypeNotAllowed: "validation.file.typeNotAllowed",
  fileEmpty: "validation.file.empty",
  fileTooLarge: "validation.file.tooLarge",
} as const;

export type ValidationMessageKey = (typeof VALIDATION_MESSAGES)[keyof typeof VALIDATION_MESSAGES];

// ───────────────────────────── Action results (PRD §12, C10) ─────────────────────────────

export const ERROR_CODE_VALUES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "INTEGRITY_LOCK",
  "ACCESS_KEY_INVALID",
  "ACCESS_KEY_LOCKED",
  "INTERNAL",
] as const;
export const errorCodeSchema = z.enum(ERROR_CODE_VALUES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Field name (dotted path for nested inputs) → list of i18n message keys. */
export type FieldErrors = Record<string, string[]>;

export interface ActionError {
  code: ErrorCode;
  /** An i18n key, never prose (conventions: Errors and results). */
  message: string;
  fieldErrors?: FieldErrors;
}

/**
 * Non-blocking notice returned as data (possible duplicate payment, tax id already in use…). `message`
 * is an i18n key; `entity` optionally links to the existing record.
 */
export interface ActionWarning {
  code: string;
  message: string;
  entity?: EntityRef;
}

export type ActionResult<T> =
  { ok: true; data: T; warnings?: ActionWarning[] } | { ok: false; error: ActionError };

/** Default i18n key of an error code: `common.errors.<CODE>`. */
export function errorMessageKey(code: ErrorCode): string {
  return `common.errors.${code}`;
}

export function actionOk<T>(data: T, warnings?: ActionWarning[]): ActionResult<T> {
  return warnings && warnings.length > 0 ? { ok: true, data, warnings } : { ok: true, data };
}

export function actionError(
  code: ErrorCode,
  message: string = errorMessageKey(code),
  fieldErrors?: FieldErrors,
): ActionResult<never> {
  const error: ActionError = fieldErrors ? { code, message, fieldErrors } : { code, message };
  return { ok: false, error };
}

/** Flattens a Zod error into `fieldErrors` keyed by dotted path (`""` → `_form`). */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// ───────────────────────────── Ids, references, dates ─────────────────────────────

/** Entity id: cuid in Hito 2, readable mock ids in Hito 1. Never trusted without a lookup (C14). */
export const idSchema = z
  .string()
  .min(1, VALIDATION_MESSAGES.required)
  .max(64, VALIDATION_MESSAGES.invalidId)
  .regex(/^[A-Za-z0-9_-]+$/, VALIDATION_MESSAGES.invalidId);
export type Id = z.infer<typeof idSchema>;

/** Lightweight pointer to an entity, used across modules instead of importing their DTOs. */
export const entityRefSchema = z.object({
  id: idSchema,
  code: z.string().optional(),
  label: z.string(),
  type: entityTypeSchema,
});
export type EntityRef = z.infer<typeof entityRefSchema>;

/** `YYYY-MM-DD` that is a real calendar date. Business dates are date-only strings (no time zone). */
export function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const dateOnlySchema = z
  .string()
  .refine(isValidDateOnly, { message: VALIDATION_MESSAGES.invalidDate });
export type DateOnly = z.infer<typeof dateOnlySchema>;

// ───────────────────────────── Lists and pagination ─────────────────────────────

export const PAGE_SIZE_VALUES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_VALUES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export type SortDirection = "asc" | "desc";

export interface ParsedSort {
  field: string;
  direction: SortDirection;
}

/** Splits a `field:asc|desc` sort string; `null` when the value is missing or malformed. */
export function parseSort(sort: string | undefined): ParsedSort | null {
  if (!sort) return null;
  const match = /^([A-Za-z][A-Za-z0-9_.]*):(asc|desc)$/.exec(sort);
  if (!match) return null;
  return { field: match[1] as string, direction: match[2] as SortDirection };
}

/** Typed filter map: a single value or a list of values per filter name (URL-friendly strings). */
export const listFiltersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
export type ListFilters = z.infer<typeof listFiltersSchema>;

/**
 * Query of every table/list. Values may arrive as URL strings (nuqs), so numbers and the boolean are
 * coerced. Module filter schemas extend it: `listQuerySchema.extend({ status: … })`.
 */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
    .default(DEFAULT_PAGE_SIZE),
  sort: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.]*:(asc|desc)$/, VALIDATION_MESSAGES.invalidSort)
    .optional(),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  filters: listFiltersSchema.default({}),
  includeArchived: z.union([z.boolean(), z.stringbool()]).default(false),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export type ListQueryInput = z.input<typeof listQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function paginated<T>(
  items: T[],
  total: number,
  query: Pick<ListQuery, "page" | "pageSize">,
): Paginated<T> {
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
