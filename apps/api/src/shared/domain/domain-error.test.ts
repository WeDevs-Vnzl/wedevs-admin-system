import { describe, expect, it } from 'vitest';
import {
  AccessKeyInvalidError,
  AccessKeyLockedError,
  ConflictError,
  DomainError,
  ForbiddenError,
  IntegrityLockedError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationFailedError,
} from './domain-error';
import { ERROR_CODE_VALUES } from './error-codes';

describe('DomainError', () => {
  it('carries the code and defaults the message to the common.errors key', () => {
    const error = new DomainError('NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('common.errors.NOT_FOUND');
    expect(error.fieldErrors).toBeUndefined();
  });

  it('keeps a custom message key and field errors', () => {
    const error = new DomainError('CONFLICT', {
      message: 'clients.errors.duplicateTaxId',
      fieldErrors: { taxId: ['clients.errors.duplicateTaxId'] },
    });
    expect(error.message).toBe('clients.errors.duplicateTaxId');
    expect(error.fieldErrors).toEqual({ taxId: ['clients.errors.duplicateTaxId'] });
  });

  it('keeps the entity link a CONFLICT points at', () => {
    const entity = { id: 'cli_1', label: 'Acme', type: 'CLIENT' } as const;
    expect(new DomainError('CONFLICT', { entity }).entity).toEqual(entity);
    expect(new DomainError('CONFLICT').entity).toBeUndefined();
  });
});

describe('error codes', () => {
  it('are the FE codes plus RATE_LIMITED', () => {
    expect([...ERROR_CODE_VALUES]).toEqual([
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'VALIDATION',
      'NOT_FOUND',
      'CONFLICT',
      'INTEGRITY_LOCK',
      'ACCESS_KEY_INVALID',
      'ACCESS_KEY_LOCKED',
      'RATE_LIMITED',
      'INTERNAL',
    ]);
  });
});

describe('subclasses', () => {
  it.each([
    [NotFoundError, 'NOT_FOUND'],
    [ConflictError, 'CONFLICT'],
    [ForbiddenError, 'FORBIDDEN'],
    [UnauthenticatedError, 'UNAUTHENTICATED'],
    [ValidationFailedError, 'VALIDATION'],
    [IntegrityLockedError, 'INTEGRITY_LOCK'],
    [AccessKeyInvalidError, 'ACCESS_KEY_INVALID'],
    [AccessKeyLockedError, 'ACCESS_KEY_LOCKED'],
    [RateLimitedError, 'RATE_LIMITED'],
  ] as const)('%o maps to %s', (Ctor, code) => {
    const error = new Ctor({ fieldErrors: { a: ['k'] } });
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(Ctor.name);
    expect(error.message).toBe(`common.errors.${code}`);
    expect(error.fieldErrors).toEqual({ a: ['k'] });
    expect(new Ctor().fieldErrors).toBeUndefined();
  });
});
