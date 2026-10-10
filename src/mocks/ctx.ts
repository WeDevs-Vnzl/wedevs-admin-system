// MOCK — the Hito 1 service context (C11, data-rules.md §2). `ctx = { db, user, now }`: in Hito 1 `db` is
// the in-memory store, in Hito 2 the Prisma client or transaction. Only `src/server/context.ts` builds it
// for the app; services receive it and never create one. Framework-free: no `next/*`, `react`,
// `next-intl` or `@clerk/*`. Deleted with `src/mocks/` at the close of Hito 2 (C9).
import { errorMessageKey, type ErrorCode, type FieldErrors } from "@/lib/validators/common";
import type { SessionUser } from "@/server/auth/types";
import { getMockStore, type MockStore } from "./store";

/** Context of an authenticated service call. `now` is the only clock a service may read. */
export interface MockServiceContext {
  db: MockStore;
  user: SessionUser;
  now: Date;
}

/** Context of a public portal service call: no user; the share link travels in the service input. */
export interface MockPublicServiceContext {
  db: MockStore;
  user: null;
  now: Date;
}

export function createMockContext(options: {
  user: SessionUser;
  now: Date;
  db?: MockStore;
}): MockServiceContext {
  return { db: options.db ?? getMockStore(), user: options.user, now: options.now };
}

export function createMockPublicContext(options: {
  now: Date;
  db?: MockStore;
}): MockPublicServiceContext {
  return { db: options.db ?? getMockStore(), user: null, now: options.now };
}

/**
 * A failure of a service (`CONFLICT`, `NOT_FOUND`, `INTEGRITY_LOCK`, …). Services throw it, never return
 * it as a DTO; the action adapter maps it to an `ActionResult` error (C10). `message` is an i18n key and
 * defaults to `common.errors.<CODE>`. Hito 2 services reuse the same class.
 */
export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;

  constructor(code: ErrorCode, options: { message?: string; fieldErrors?: FieldErrors } = {}) {
    super(options.message ?? errorMessageKey(code));
    this.name = "ServiceError";
    this.code = code;
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
  }
}
