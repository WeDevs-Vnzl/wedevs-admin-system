import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  getCorrelationId,
  isWellFormedCorrelationId,
} from './correlation-id.middleware';

function run(inbound?: string) {
  const headers = new Map<string, string>();
  const res = {
    locals: {} as Record<string, unknown>,
    setHeader: (name: string, value: string) => headers.set(name, value),
  } as unknown as Response;
  const req = { header: () => inbound } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  new CorrelationIdMiddleware().use(req, res, next);
  return { res, headers, next };
}

describe('CorrelationIdMiddleware', () => {
  it('keeps a well-formed inbound id and echoes it in the header', () => {
    const { res, headers, next } = run('req-12345678');
    expect(getCorrelationId(res)).toBe('req-12345678');
    expect(headers.get(CORRELATION_ID_HEADER)).toBe('req-12345678');
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates an id when none is sent', () => {
    const { res, headers } = run(undefined);
    const id = getCorrelationId(res);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get(CORRELATION_ID_HEADER)).toBe(id);
  });

  it.each(['short', 'has space in it!', 'a'.repeat(129), 'bad\r\nheader: x', ''])(
    'replaces the malformed id %j',
    (bad) => {
      const { res } = run(bad);
      expect(getCorrelationId(res)).not.toBe(bad);
      expect(getCorrelationId(res)).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('validates the format', () => {
    expect(isWellFormedCorrelationId('abc.DEF_123-xyz')).toBe(true);
    expect(isWellFormedCorrelationId(42)).toBe(false);
  });

  it('getCorrelationId is null when the middleware never ran', () => {
    expect(getCorrelationId({ locals: {} } as unknown as Response)).toBeNull();
  });
});
