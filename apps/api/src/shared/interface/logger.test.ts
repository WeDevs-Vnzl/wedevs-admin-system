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
});
