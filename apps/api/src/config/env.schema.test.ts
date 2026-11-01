import { describe, expect, it } from 'vitest';
import { InvalidEnvError, parseEnv } from './env.schema';

const valid = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://postgres:secret-password@localhost:5432/core',
  CLERK_SECRET_KEY: 'sk_test_placeholder',
  CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
  CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nplaceholder\n-----END PUBLIC KEY-----',
  CLERK_WEBHOOK_SECRET: 'whsec_placeholder',
  CLOUDINARY_CLOUD_NAME: 'cloud-placeholder',
  CLOUDINARY_API_KEY: 'key-placeholder',
  CLOUDINARY_API_SECRET: 'secret-placeholder',
  SHARE_IP_SALT: 'a'.repeat(32),
  SHARE_UNLOCK_SECRET: 'b'.repeat(32),
};

const BE1_NAMES = [
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_JWT_KEY',
  'CLERK_WEBHOOK_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const;

describe('parseEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = parseEnv(valid);
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('test');
    expect(config.SENTRY_DSN).toBeUndefined();
  });

  it('coerces PORT and keeps SENTRY_DSN when present', () => {
    const config = parseEnv({ ...valid, PORT: '4100', SENTRY_DSN: 'https://example.invalid/1' });
    expect(config.PORT).toBe(4100);
    expect(config.SENTRY_DSN).toBe('https://example.invalid/1');
  });

  it('fails on a missing DATABASE_URL and lists the name without any value', () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(InvalidEnvError);
    try {
      parseEnv(rest);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain('secret-password');
      expect(message).not.toContain('localhost');
    }
  });

  it('never leaks the rejected value of an invalid variable', () => {
    try {
      parseEnv({ ...valid, APP_URL: 'not-a-url-leaky', NODE_ENV: 'staging' });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('APP_URL');
      expect(message).toContain('NODE_ENV');
      expect(message).not.toContain('leaky');
      expect(message).not.toContain('staging');
    }
  });

  it('exposes the BE-1 variables on the typed config', () => {
    const config = parseEnv(valid);
    for (const name of BE1_NAMES) expect(config[name]).toBe(valid[name]);
  });

  describe.each(BE1_NAMES)('%s', (name) => {
    it('fails when missing and lists the name without any value', () => {
      const { [name]: _omitted, ...rest } = valid;
      try {
        parseEnv(rest);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidEnvError);
        const message = (error as Error).message;
        expect(message).toContain(name);
        for (const other of BE1_NAMES) {
          expect(message).not.toContain(valid[other]);
        }
      }
    });

    it('fails when empty', () => {
      expect(() => parseEnv({ ...valid, [name]: '' })).toThrow(name);
    });
  });

  describe('BE-4 variables', () => {
    it('applies the defaults: throttle 60 per 60 s, no trusted proxy', () => {
      const config = parseEnv(valid);
      expect(config.THROTTLE_TTL).toBe(60);
      expect(config.THROTTLE_LIMIT).toBe(60);
      expect(config.TRUST_PROXY_HOPS).toBe(0);
    });

    it('coerces the numeric variables', () => {
      const config = parseEnv({
        ...valid,
        THROTTLE_TTL: '30',
        THROTTLE_LIMIT: '10',
        TRUST_PROXY_HOPS: '1',
      });
      expect(config).toMatchObject({ THROTTLE_TTL: 30, THROTTLE_LIMIT: 10, TRUST_PROXY_HOPS: 1 });
    });

    it.each(['TRUST_PROXY_HOPS', 'THROTTLE_TTL', 'THROTTLE_LIMIT'])(
      'rejects a non-integer or out-of-range %s, naming it only',
      (name) => {
        for (const bad of ['1.5', 'x', '-1']) {
          expect(() => parseEnv({ ...valid, [name]: bad })).toThrow(name);
        }
      },
    );

    it.each(['SHARE_IP_SALT', 'SHARE_UNLOCK_SECRET'] as const)(
      '%s is required, at least 32 characters, and a failure never echoes the value',
      (name) => {
        const { [name]: _omitted, ...rest } = valid;
        expect(() => parseEnv(rest)).toThrow(name);
        const short = 'short-secret-value-xyz';
        try {
          parseEnv({ ...valid, [name]: short });
          expect.unreachable();
        } catch (error) {
          expect((error as Error).message).toContain(name);
          expect((error as Error).message).not.toContain(short);
        }
        expect(parseEnv({ ...valid, [name]: 'c'.repeat(32) })[name]).toBe('c'.repeat(32));
      },
    );
  });

  describe('REDIS_URL (DT-169)', () => {
    it('is optional, so the API boots without it', () => {
      expect(parseEnv(valid).REDIS_URL).toBeUndefined();
    });

    it('is kept when present', () => {
      expect(parseEnv({ ...valid, REDIS_URL: 'redis://redis:6379' }).REDIS_URL).toBe(
        'redis://redis:6379',
      );
    });

    it('rejects an empty value, naming the variable only', () => {
      expect(() => parseEnv({ ...valid, REDIS_URL: '' })).toThrow('REDIS_URL');
    });
  });
});
