import { describe, expect, it } from 'vitest';
import { AsyncLocalRequestContext } from './request-context.adapter';

describe('AsyncLocalRequestContext', () => {
  const meta = { ip: '203.0.113.7', userAgent: 'vitest' };

  it('is null outside run', () => {
    expect(new AsyncLocalRequestContext().current()).toBeNull();
  });

  it('exposes the metadata across awaits inside run', async () => {
    const ctx = new AsyncLocalRequestContext();
    const seen = await ctx.run(meta, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return ctx.current();
    });
    expect(seen).toEqual(meta);
    expect(ctx.current()).toBeNull();
  });

  it('keeps concurrent runs isolated', async () => {
    const ctx = new AsyncLocalRequestContext();
    const read = (m: typeof meta, ms: number) =>
      ctx.run(m, async () => {
        await new Promise((r) => setTimeout(r, ms));
        return ctx.current();
      });
    const [a, b] = await Promise.all([
      read({ ...meta, ip: 'a' }, 10),
      read({ ...meta, ip: 'b' }, 1),
    ]);
    expect([a?.ip, b?.ip]).toEqual(['a', 'b']);
  });
});
