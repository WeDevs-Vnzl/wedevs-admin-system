import { describe, expect, it } from 'vitest';
import {
  InvalidEnvError,
  featuresOf,
  integrationsOf,
  parseEnv,
  parseWorkerEnv,
} from '../../src/config/env.schema';

const base = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://postgres:placeholder@localhost:5432/core',
  CLOUDINARY_CLOUD_NAME: 'cloud-placeholder',
  CLOUDINARY_API_KEY: 'key-placeholder',
  CLOUDINARY_API_SECRET: 'secret-placeholder',
  SHARE_IP_SALT: 'a'.repeat(32),
  SHARE_UNLOCK_SECRET: 'b'.repeat(32),
};
const clerk = {
  CLERK_SECRET_KEY: 'sk_test_placeholder',
  CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
  CLERK_JWT_KEY: 'jwt-placeholder',
  CLERK_WEBHOOK_SECRET: 'whsec_placeholder',
};
const api = { ...base, ...clerk };
const worker = { ...base, REDIS_URL: 'redis://redis:6379' };

const allKeys = {
  STRIPE_SECRET_KEY: 's',
  STRIPE_WEBHOOK_SECRET: 'w',
  BINANCE_API_KEY: 'k',
  BINANCE_API_SECRET: 'x',
};

const PAIRS = [
  ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
] as const;

function namesOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidEnvError) return error.names;
    throw error;
  }
  throw new Error('expected InvalidEnvError');
}

describe.each([
  ['API', (raw: Record<string, string>) => parseEnv(raw), api],
  ['worker', (raw: Record<string, string>) => parseWorkerEnv(raw), worker],
] as const)('%s integration variables', (_label, parse, ok) => {
  it('accepts none of them and exposes null views', () => {
    const view = integrationsOf(parse(ok));
    expect(view).toEqual({ stripe: null, binance: null });
  });

  it.each(PAIRS)('accepts the complete pair %s / %s', (first, second) => {
    const config = parse({ ...ok, [first]: 'placeholder-1', [second]: 'placeholder-2' });
    expect(config[first]).toBe('placeholder-1');
    expect(config[second]).toBe('placeholder-2');
  });

  it.each(PAIRS)('refuses %s alone, naming only the missing %s', (first, second) => {
    const names = namesOf(() => parse({ ...ok, [first]: 'leaky-value' }));
    expect(names).toEqual([second]);
    expect(String(names)).not.toContain('leaky-value');
  });

  it.each(PAIRS)('refuses %2$s alone, naming only %1$s', (first, second) => {
    expect(namesOf(() => parse({ ...ok, [second]: 'leaky-value' }))).toEqual([first]);
  });

  it('builds the typed views from complete pairs with their flags on', () => {
    const view = integrationsOf(
      parse({
        ...ok,
        FEATURE_STRIPE: 'true',
        FEATURE_BINANCE: 'true',
        STRIPE_SECRET_KEY: 's',
        STRIPE_WEBHOOK_SECRET: 'w',
        BINANCE_API_KEY: 'k',
        BINANCE_API_SECRET: 'x',
      }),
    );
    expect(view.stripe).toEqual({ secretKey: 's', webhookSecret: 'w' });
    expect(view.binance).toEqual({ apiKey: 'k', apiSecret: 'x' });
  });

  it('keeps every flag off by default, even with complete pairs (DT-227)', () => {
    const config = parse({ ...ok, ...allKeys });
    expect(integrationsOf(config)).toEqual({ stripe: null, binance: null });
    expect(featuresOf(config)).toEqual({ stripe: false, binance: false, bankSync: false });
  });

  it('turns a provider off when its flag is "false", even with its pair', () => {
    const config = parse({ ...ok, ...allKeys, FEATURE_STRIPE: 'false', FEATURE_BINANCE: 'true' });
    expect(featuresOf(config)).toEqual({ stripe: false, binance: true, bankSync: false });
  });

  it.each([
    ['FEATURE_STRIPE', PAIRS[0]],
    ['FEATURE_BINANCE', PAIRS[1]],
  ] as const)('refuses %s=true without its pair, naming both keys', (flag, pair) => {
    expect([...namesOf(() => parse({ ...ok, [flag]: 'true' }))].sort()).toEqual([...pair].sort());
  });

  it('names a missing key once when a half pair also has its flag on', () => {
    const names = namesOf(() => parse({ ...ok, FEATURE_STRIPE: 'true', STRIPE_SECRET_KEY: 'leaky' }));
    expect(names).toEqual(['STRIPE_WEBHOOK_SECRET']);
  });

  it('exposes FEATURE_BANK_SYNC as the flag alone (no bank adapter yet, DT-186)', () => {
    expect(featuresOf(parse({ ...ok, FEATURE_BANK_SYNC: 'true' })).bankSync).toBe(true);
  });

  it.each(['FEATURE_STRIPE', 'FEATURE_BINANCE', 'FEATURE_BANK_SYNC'])(
    'refuses a %s that is not "true" or "false", naming it',
    (flag) => {
      expect(namesOf(() => parse({ ...ok, [flag]: 'yes' }))).toEqual([flag]);
    },
  );

  it('reports a pair problem together with another invalid variable', () => {
    const names = namesOf(() => parse({ ...ok, STRIPE_SECRET_KEY: 's', APP_URL: 'nope' }));
    expect([...names].sort()).toEqual(['APP_URL', 'STRIPE_WEBHOOK_SECRET']);
  });
});

describe('worker environment (DT-181 9a, DT-191)', () => {
  it('needs no Clerk variable', () => {
    expect(parseWorkerEnv(worker).REDIS_URL).toBe('redis://redis:6379');
  });

  it('requires REDIS_URL, naming the variable only', () => {
    expect(namesOf(() => parseWorkerEnv(base))).toEqual(['REDIS_URL']);
  });

  it.each([
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'SHARE_IP_SALT',
    'SHARE_UNLOCK_SECRET',
    'APP_URL',
    'DATABASE_URL',
  ] as const)('refuses a missing %s, naming it', (name) => {
    const { [name]: _omitted, ...rest } = worker;
    expect(namesOf(() => parseWorkerEnv(rest))).toEqual([name]);
  });

  it('still requires the Clerk variables for the API', () => {
    expect(namesOf(() => parseEnv(base))).toEqual(Object.keys(clerk));
  });
});
