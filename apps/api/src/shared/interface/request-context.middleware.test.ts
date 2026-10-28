import type { NextFunction, Request } from 'express';
import { describe, expect, it } from 'vitest';
import type { RequestMetadata } from '../application/ports/request-context.port';
import { AsyncLocalRequestContext } from '../infrastructure/request-context.adapter';
import { RequestContextMiddleware, USER_AGENT_MAX_LENGTH } from './request-context.middleware';

function handle(req: { ip?: string; ua?: string }): RequestMetadata | null {
  const ctx = new AsyncLocalRequestContext();
  let seen: RequestMetadata | null = null;
  const next = (() => {
    seen = ctx.current();
  }) as NextFunction;
  new RequestContextMiddleware(ctx).use(
    { ip: req.ip, header: () => req.ua } as unknown as Request,
    {},
    next,
  );
  return seen;
}

describe('RequestContextMiddleware', () => {
  it('runs the rest of the request with ip and user agent', () => {
    expect(handle({ ip: '203.0.113.7', ua: 'Mozilla/5.0' })).toEqual({
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });
  it('truncates the user agent to 512 characters', () => {
    const seen = handle({ ip: '1.2.3.4', ua: 'a'.repeat(900) });
    expect(seen?.userAgent).toHaveLength(USER_AGENT_MAX_LENGTH);
  });
  it('uses null when ip or user agent are missing', () => {
    expect(handle({})).toEqual({ ip: null, userAgent: null });
  });
});
