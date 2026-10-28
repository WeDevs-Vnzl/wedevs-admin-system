import type { EntityRef } from './entity-ref';
import { errorMessageKey, type ErrorCode } from './error-codes';

/** Field errors keyed by input path; values are i18n keys. */
export type FieldErrors = Record<string, string[]>;

export interface DomainErrorOptions {
  /** i18n key; defaults to `common.errors.<CODE>`. */
  readonly message?: string;
  readonly fieldErrors?: FieldErrors;
  /** The record the error points at (a `CONFLICT` on an existing record). */
  readonly entity?: EntityRef;
}

/**
 * A business failure. Use cases throw it; the interface layer maps it to the error envelope
 * (`api-contract.md` §4). `message` is an i18n key, never translated text.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  readonly entity?: EntityRef;

  constructor(code: ErrorCode, options: DomainErrorOptions = {}) {
    super(options.message ?? errorMessageKey(code));
    this.name = new.target.name;
    this.code = code;
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options.entity) this.entity = options.entity;
  }
}

export class NotFoundError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('NOT_FOUND', options);
  }
}

export class ConflictError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('CONFLICT', options);
  }
}

export class ForbiddenError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('FORBIDDEN', options);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('UNAUTHENTICATED', options);
  }
}

export class ValidationFailedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('VALIDATION', options);
  }
}

export class IntegrityLockedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('INTEGRITY_LOCK', options);
  }
}

export class AccessKeyInvalidError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('ACCESS_KEY_INVALID', options);
  }
}

export class AccessKeyLockedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('ACCESS_KEY_LOCKED', options);
  }
}

export class RateLimitedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super('RATE_LIMITED', options);
  }
}
