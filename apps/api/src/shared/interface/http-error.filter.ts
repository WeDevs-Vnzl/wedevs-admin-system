import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { DomainError, errorMessageKey, type ErrorCode, type FieldErrors } from '../domain';
import { CORRELATION_ID_HEADER, getCorrelationId } from './correlation-id.middleware';
import type { ErrorResponse } from './error-envelope';
import { APP_LOGGER, type AppLogger } from './logger';
import { VALIDATION_MESSAGES, zodFieldErrors } from './common.schemas';

/** HTTP status of each error code (`api-contract.md` §4). */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTEGRITY_LOCK: 409,
  ACCESS_KEY_INVALID: 401,
  ACCESS_KEY_LOCKED: 429,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

interface Mapped {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fieldErrors: FieldErrors | null;
  readonly entity: ErrorResponse['error']['entity'];
}

const simple = (code: ErrorCode): Mapped => ({
  code,
  message: errorMessageKey(code),
  fieldErrors: null,
  entity: null,
});

const validation = (key: string): Mapped => ({
  ...simple('VALIDATION'),
  fieldErrors: { _form: [key] },
});

/** body-parser errors (malformed JSON, oversized body) carry a `type` and are not HttpExceptions. */
function bodyParserKey(exception: unknown): string | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const type: unknown = (exception as { type?: unknown }).type;
  if (type === 'entity.parse.failed' || type === 'encoding.unsupported') {
    return VALIDATION_MESSAGES.invalidFormat;
  }
  if (type === 'entity.too.large') return VALIDATION_MESSAGES.tooLarge;
  return null;
}

function mapHttpException(exception: HttpException): Mapped {
  switch (exception.getStatus()) {
    case HttpStatus.UNAUTHORIZED:
      return simple('UNAUTHENTICATED');
    case HttpStatus.FORBIDDEN:
      return simple('FORBIDDEN');
    case HttpStatus.NOT_FOUND:
      return simple('NOT_FOUND');
    case HttpStatus.TOO_MANY_REQUESTS:
      return simple('RATE_LIMITED');
    case HttpStatus.BAD_REQUEST:
      return validation(VALIDATION_MESSAGES.invalidFormat);
    default:
      return simple('INTERNAL');
  }
}

/** Pure mapping of any thrown value to the envelope's content; exported for tests. */
export function mapException(exception: unknown): Mapped {
  if (exception instanceof DomainError) {
    if (exception.code === 'INTERNAL') return simple('INTERNAL');
    return {
      code: exception.code,
      message: exception.message,
      fieldErrors: exception.fieldErrors ?? null,
      entity: exception.entity
        ? {
            type: exception.entity.type,
            id: exception.entity.id,
            code: exception.entity.code ?? null,
            label: exception.entity.label,
          }
        : null,
    };
  }
  if (exception instanceof ZodValidationException) {
    const zodError = exception.getZodError() as {
      issues?: Parameters<typeof zodFieldErrors>[0]['issues'];
    };
    const fieldErrors = zodError.issues ? zodFieldErrors({ issues: zodError.issues }) : null;
    return {
      ...simple('VALIDATION'),
      fieldErrors: fieldErrors && Object.keys(fieldErrors).length > 0 ? fieldErrors : null,
    };
  }
  const parserKey = bodyParserKey(exception);
  if (parserKey) return validation(parserKey);
  if (exception instanceof HttpException) return mapHttpException(exception);
  return simple('INTERNAL');
}

/** Global filter: every failure leaves as the `api-contract.md` §4 envelope. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(@Inject(APP_LOGGER) private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const correlationId = getCorrelationId(res) ?? 'unknown';
    const mapped = mapException(exception);
    const status = ERROR_STATUS[mapped.code];

    if (status >= 500) {
      this.logger.error(
        {
          err: exception,
          correlationId,
          method: req.method,
          url: req.originalUrl ?? req.url,
        },
        'Unhandled exception',
      );
    }

    if (res.headersSent) return;
    const body: ErrorResponse = {
      error: {
        code: mapped.code,
        message: mapped.message,
        fieldErrors: mapped.fieldErrors,
        entity: mapped.entity,
        correlationId,
      },
    };
    if (!res.getHeader(CORRELATION_ID_HEADER)) res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.status(status).json(body);
  }
}
