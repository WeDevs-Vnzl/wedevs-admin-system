import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  it('emits JSON and redacts authorization, cookie and set-cookie', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ destination });
    logger.info(
      {
        req: { headers: { authorization: 'Bearer secret-jwt', cookie: 'sid=abc', accept: 'x' } },
        res: { headers: { 'set-cookie': 'sid=def' } },
        headers: { authorization: 'Bearer top-level' },
      },
      'request',
    );
    const out = lines.join('');
    expect(out).not.toMatch(/secret-jwt|sid=abc|sid=def|top-level/);
    const parsed = JSON.parse(out) as { msg: string; req: { headers: Record<string, string> } };
    expect(parsed.msg).toBe('request');
    expect(parsed.req.headers['authorization']).toBe('[Redacted]');
    expect(parsed.req.headers['accept']).toBe('x');
  });

  it('masks the share token after /portal/ in url fields, keeping the rest of the path and query', () => {
    const token = 'k3J9xQ2mV8aL0pZr7tYb4NcWd1HfGs6UeIo5AvXqMiE';
    expect(token).toHaveLength(43);
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ destination });
    logger.error(
      { url: `/api/v1/portal/${token}/files/doc1?disposition=inline`, method: 'GET' },
      'x',
    );
    logger.info(
      { req: { url: `/api/v1/portal/${token}`, originalUrl: `/api/v1/portal/${token}?a=1` } },
      'y',
    );
    logger.info({ url: '/api/v1/documents/doc1' }, 'z');
    const out = lines.join('');
    expect(out).not.toContain(token);
    const [first, second, third] = lines.map(
      (l) => JSON.parse(l) as { url?: string; req: { url: string; originalUrl: string } },
    );
    expect(first?.url).toBe('/api/v1/portal/[Redacted]/files/doc1?disposition=inline');
    expect(second?.req.url).toBe('/api/v1/portal/[Redacted]');
    expect(second?.req.originalUrl).toBe('/api/v1/portal/[Redacted]?a=1');
    expect(third?.url).toBe('/api/v1/documents/doc1');
  });
});
