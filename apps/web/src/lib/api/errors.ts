import {
  ERROR_CODE_VALUES,
  errorMessageKey,
  type ActionError,
  type EntityRef,
  type ErrorCode,
  type FieldErrors,
} from "@/lib/validators/common";

/**
 * API error envelope (`api-contract.md` §4) → `ActionResult` error / UI state (`frontend-patterns.md` §16).
 * Pure: no `next/*`, `react` or Clerk. The BE returns i18n keys, never prose; the FE translates them (C1).
 */

/** Where an `UNAUTHENTICATED` result sends the user. */
export const SIGN_IN_PATH = "/sign-in";

/** An `ActionError` plus the API-only extras the UI may use. Assignable to `ActionError`. */
export interface ApiActionError extends ActionError {
  /** Support reference of an `INTERNAL` error (shown in the toast). */
  correlationId?: string;
  /** Set for `UNAUTHENTICATED`: the UI redirects here. */
  redirectTo?: string;
}

export type ApiActionResult<T> = { ok: true; data: T } | { ok: false; error: ApiActionError };

export interface MapOptions {
  /** Optional catalog check; a key it rejects falls back to `common.errors.<code>`. */
  isKnownKey?: (key: string) => boolean;
}

/** `namespace.path.to.key`: dotted identifiers, no spaces. Anything else is prose and is discarded. */
const MESSAGE_KEY = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODE_VALUES as readonly string[]).includes(value);
}

function internal(): ApiActionError {
  return { code: "INTERNAL", message: errorMessageKey("INTERNAL") };
}

function messageFor(code: ErrorCode, raw: unknown, options: MapOptions): string {
  if (typeof raw === "string" && MESSAGE_KEY.test(raw) && (options.isKnownKey?.(raw) ?? true)) {
    return raw;
  }
  return errorMessageKey(code);
}

function fieldErrorsOf(raw: unknown): FieldErrors | undefined {
  if (!isRecord(raw)) return undefined;
  const out: FieldErrors = {};
  for (const [path, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    const keys = value.filter((item): item is string => typeof item === "string");
    if (keys.length > 0) out[path] = keys;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function entityOf(raw: unknown): EntityRef | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, label, type, code } = raw;
  if (typeof id !== "string" || typeof label !== "string" || typeof type !== "string") {
    return undefined;
  }
  const entity = { id, label, type } as EntityRef;
  if (typeof code === "string") entity.code = code;
  return entity;
}

/**
 * Maps a parsed error body to an `ApiActionError`. A body that is not a known envelope (HTML from a
 * proxy, text, an unknown code) is an `INTERNAL`.
 */
export function envelopeToActionError(body: unknown, options: MapOptions = {}): ApiActionError {
  const raw = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  if (!raw || !isErrorCode(raw.code)) return internal();

  const code = raw.code;
  const error: ApiActionError = { code, message: messageFor(code, raw.message, options) };
  const fieldErrors = fieldErrorsOf(raw.fieldErrors);
  if (fieldErrors) error.fieldErrors = fieldErrors;
  const entity = entityOf(raw.entity);
  if (entity) error.entity = entity;
  if (typeof raw.correlationId === "string" && raw.correlationId) {
    error.correlationId = raw.correlationId;
  }
  if (code === "UNAUTHENTICATED") error.redirectTo = SIGN_IN_PATH;
  return error;
}

/** The shape `openapi-fetch` returns from every call. */
export interface ApiResponseLike<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** `openapi-fetch` result → `ActionResult`. A 2xx (including a 204 with no body) is `ok`. */
export function toActionResult<T>(
  result: ApiResponseLike<T>,
  options: MapOptions = {},
): ApiActionResult<T> {
  if (result.error !== undefined || !result.response.ok) {
    return { ok: false, error: envelopeToActionError(result.error, options) };
  }
  return { ok: true, data: result.data as T };
}

/** A network failure (fetch rejected, DNS, abort) is an `INTERNAL`; details are not leaked to the UI. */
export function fromThrown(error: unknown): { ok: false; error: ApiActionError } {
  console.error("[api] request failed", error);
  return { ok: false, error: internal() };
}

/** `true` for the 422 the BE sends when `sort` is outside the whitelist (the table drops the sort). */
export function isInvalidSortError(error: ActionError): boolean {
  return (
    error.code === "VALIDATION" &&
    (error.fieldErrors?.sort ?? []).includes("validation.sort.invalid")
  );
}
