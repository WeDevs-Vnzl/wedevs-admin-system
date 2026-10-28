import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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
} from '../domain';
import { errorResponseSchema, type ErrorResponse } from './error-envelope';
import { HttpErrorFilter } from './http-error.filter';
import type { AppLogger } from './logger';

function run(exception: unknown, correlationId: string | null = 'corr-12345678') {
  const logger: AppLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const headers = new Map<string, string>();
  let status = 0;
  let body: ErrorResponse | undefined;
  const res = {
    locals: correlationId ? { correlationId } : {},
    headersSent: false,
    getHeader: (name: string) => headers.get(name),
    setHeader: (name: string, value: string) => headers.set(name, value),
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: ErrorResponse) {
      body = payload;
    },
  } as unknown as Response;
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/x' }),
    }),
  } as unknown as ArgumentsHost;
  new HttpErrorFilter(logger).catch(exception, host);
  return { status, body: body as ErrorResponse, logger, headers };
}

const entity = { type: 'CLIENT', id: 'cli_1', code: 'CLI-0007', label: 'Kairos' } as const;

describe('HttpErrorFilter - api-contract §4 mapping table', () => {
  it.each([
    ['UnauthenticatedError', new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    ['ForbiddenError', new ForbiddenError(), 403, 'FORBIDDEN'],
    ['ValidationFailedError', new ValidationFailedError(), 422, 'VALIDATION'],
    ['NotFoundError', new NotFoundError(), 404, 'NOT_FOUND'],
    ['ConflictError', new ConflictError(), 409, 'CONFLICT'],
    ['IntegrityLockedError', new IntegrityLockedError(), 409, 'INTEGRITY_LOCK'],
    ['AccessKeyInvalidError', new AccessKeyInvalidError(), 401, 'ACCESS_KEY_INVALID'],
    ['AccessKeyLockedError', new AccessKeyLockedError(), 429, 'ACCESS_KEY_LOCKED'],
    ['RateLimitedError', new RateLimitedError(), 429, 'RATE_LIMITED'],
    ['DomainError(INTERNAL)', new DomainError('INTERNAL', { message: 'secret' }), 500, 'INTERNAL'],
  ])('%s -> %i %s', (_name, error, status, code) => {
    const result = run(error);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
    expect(result.body.error.message).toBe(`common.errors.${code}`);
    expect(errorResponseSchema.safeParse(result.body).success).toBe(true);
  });

  it('keeps a custom i18n key, fieldErrors and the entity of a DomainError', () => {
    const result = run(
      new ConflictError({
        message: 'clients.errors.taxIdTaken',
        fieldErrors: { taxId: ['validation.unique'] },
        entity,
      }),
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toEqual({
      code: 'CONFLICT',
      message: 'clients.errors.taxIdTaken',
      fieldErrors: { taxId: ['validation.unique'] },
      entity,
      correlationId: 'corr-12345678',
    });
  });

  it('serializes absent fieldErrors, entity and entity.code as null', () => {
    const plain = run(new NotFoundError());
    expect(plain.body.error.fieldErrors).toBeNull();
    expect(plain.body.error.entity).toBeNull();
    const noCode = run(new ConflictError({ entity: { type: 'CLIENT', id: 'c', label: 'L' } }));
    expect(noCode.body.error.entity).toEqual({ type: 'CLIENT', id: 'c', code: null, label: 'L' });
  });

  it('nestjs-zod validation exception -> 422 VALIDATION keyed by dotted path, _form for root', () => {
    const schema = z
      .object({ lines: z.array(z.object({ qty: z.string().min(1, 'validation.required') })) })
      .refine(() => false, { message: 'validation.invalid' });
    const parsed = schema.safeParse({ lines: [{ qty: '' }] });
    const result = run(new ZodValidationException(parsed.error));
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('VALIDATION');
    expect(result.body.error.fieldErrors).toEqual({
      'lines.0.qty': ['validation.required'],
      _form: ['validation.invalid'],
    });
  });

  it('a Zod exception without issues has null fieldErrors', () => {
    expect(run(new ZodValidationException({})).body.error.fieldErrors).toBeNull();
  });

  it('unknown route (Nest 404) -> 404 NOT_FOUND', () => {
    const result = run(new NotFoundException('Cannot GET /nope'));
    expect(result.status).toBe(404);
    expect(result.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'common.errors.NOT_FOUND',
    });
  });

  it.each([
    [new UnauthorizedException('jwt expired'), 401, 'UNAUTHENTICATED'],
    [new ForbiddenException('nope'), 403, 'FORBIDDEN'],
    [new HttpException('Too Many Requests', 429), 429, 'RATE_LIMITED'],
  ])('Nest %#: status -> code without leaking its message', (error, status, code) => {
    const result = run(error);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
    expect(result.body.error.message).toBe(`common.errors.${code}`);
  });

  it('malformed JSON (body-parser) -> 422 VALIDATION', () => {
    const syntax = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
      type: 'entity.parse.failed',
      status: 400,
    });
    const result = run(syntax);
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('VALIDATION');
    expect(result.body.error.fieldErrors).toEqual({ _form: ['validation.invalidFormat'] });
    expect(JSON.stringify(result.body)).not.toContain('Unexpected token');
  });

  it('oversized body -> 422 VALIDATION', () => {
    const result = run(Object.assign(new Error('too large'), { type: 'entity.too.large' }));
    expect(result.status).toBe(422);
    expect(result.body.error.fieldErrors).toEqual({ _form: ['validation.tooLarge'] });
  });

  it('a generic Nest 400 -> 422 VALIDATION', () => {
    const result = run(new BadRequestException('Bad'));
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('VALIDATION');
  });

  it('INTERNAL leaks nothing and is logged with the correlation id', () => {
    const boom = new Error('connection to db at 10.0.0.5 refused: password=hunter2');
    const result = run(boom);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: {
        code: 'INTERNAL',
        message: 'common.errors.INTERNAL',
        fieldErrors: null,
        entity: null,
        correlationId: 'corr-12345678',
      },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/hunter2|10\.0\.0\.5|stack/);
    expect(result.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, correlationId: 'corr-12345678' }),
      expect.any(String),
    );
  });

  it('other 5xx Nest exceptions and non-Error throws are INTERNAL', () => {
    expect(run(new InternalServerErrorException('x')).body.error.code).toBe('INTERNAL');
    expect(run('a string').status).toBe(500);
    expect(run(null).status).toBe(500);
    expect(run(new HttpException('teapot', 418)).body.error.code).toBe('INTERNAL');
  });

  it('does not log 4xx errors', () => {
    const result = run(new NotFoundError());
    expect(result.logger.error).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder id and sets the header when the middleware never ran', () => {
    const result = run(new NotFoundError(), null);
    expect(result.body.error.correlationId).toBe('unknown');
    expect(result.headers.get('X-Request-Id')).toBe('unknown');
  });
});
