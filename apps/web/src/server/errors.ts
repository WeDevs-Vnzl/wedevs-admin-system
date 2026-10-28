// Framework-free on purpose (C9, DT-37): no `server-only`, no `next/*`, no mocks. Hito 1 mock services and
// Hito 2 Prisma services throw the same class, and it survives the deletion of `src/mocks/` (C9).
import {
  errorMessageKey,
  type EntityRef,
  type ErrorCode,
  type FieldErrors,
} from "@/lib/validators/common";

export type ServiceErrorCode = ErrorCode;

/**
 * A failure of a service (`CONFLICT`, `NOT_FOUND`, `INTEGRITY_LOCK`, …). Services throw it, never return
 * it as a DTO; the action adapter maps it to an `ActionResult` error (C10). `message` is an i18n key and
 * defaults to `common.errors.<CODE>`.
 */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly fieldErrors?: FieldErrors;
  /** The record the error points at (a `CONFLICT` on an existing record); reaches the client unchanged. */
  readonly entity?: EntityRef;

  constructor(
    code: ServiceErrorCode,
    options: { message?: string; fieldErrors?: FieldErrors; entity?: EntityRef } = {},
  ) {
    super(options.message ?? errorMessageKey(code));
    this.name = "ServiceError";
    this.code = code;
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options.entity) this.entity = options.entity;
  }
}
