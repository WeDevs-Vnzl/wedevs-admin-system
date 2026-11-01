import { describe, expect, it } from 'vitest';
import { requireRedisUrl } from './worker.module';

describe('requireRedisUrl', () => {
  it('returns the url when set', () => {
    expect(requireRedisUrl('redis://redis:6379')).toBe('redis://redis:6379');
  });

  it.each([undefined, ''])('refuses %j, naming only the variable', (value) => {
    try {
      requireRedisUrl(value);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('REDIS_URL is required to start the worker');
    }
  });
});
