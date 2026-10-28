import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'X-Request-Id';

/** A well-formed inbound id: 8-128 chars of letters, digits, `.`, `_`, `-` (no header injection). */
const WELL_FORMED = /^[A-Za-z0-9._-]{8,128}$/;

export function isWellFormedCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && WELL_FORMED.test(value);
}

/** The correlation id of a request already handled by the middleware (`null` if it never ran). */
export function getCorrelationId(res: Response): string | null {
  const id: unknown = res.locals['correlationId'];
  return typeof id === 'string' ? id : null;
}

/**
 * Accepts a well-formed `X-Request-Id` or generates one, exposes it on `res.locals.correlationId`
 * (read by the error filter and the logger) and echoes it in the response header.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header(CORRELATION_ID_HEADER);
    const id = isWellFormedCorrelationId(inbound) ? inbound : randomUUID();
    res.locals['correlationId'] = id;
    res.setHeader(CORRELATION_ID_HEADER, id);
    next();
  }
}
