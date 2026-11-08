import { z } from 'zod';

const optionalSecret = z.string().min(1).optional();

/** Optional integration credentials (BE-6). Each pair is all-or-nothing, see `requireCompletePairs`. */
const integrationFields = {
  STRIPE_SECRET_KEY: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  BINANCE_API_KEY: optionalSecret,
  BINANCE_API_SECRET: optionalSecret,
};

const INTEGRATION_PAIRS = [
  ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
] as const;

/** `"true"` or `"false"`, default off (DT-227). */
const featureFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/**
 * Integration feature flags (DT-227). A provider is on only when its flag is `true` and its key pair is complete;
 * `FEATURE_BANK_SYNC` has no adapter yet (DT-186) and gates the phase-2 bank module.
 */
const featureFields = {
  FEATURE_STRIPE: featureFlag,
  FEATURE_BINANCE: featureFlag,
  FEATURE_BANK_SYNC: featureFlag,
};

/** A flag turned on needs its key pair: each missing key is named, never a value. */
const FLAG_PAIRS = [
  ['FEATURE_STRIPE', INTEGRATION_PAIRS[0]],
  ['FEATURE_BINANCE', INTEGRATION_PAIRS[1]],
] as const;

function requireKeysForFlags(raw: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const [flag, pair] of FLAG_PAIRS) {
    if (raw[flag] !== true) continue;
    for (const name of pair) {
      if (raw[name] === undefined) {
        ctx.addIssue({ code: 'custom', path: [name], message: `required when ${flag} is true` });
      }
    }
  }
}

/** Both checks; a variable named twice is reported once (`invalidNames` dedupes). */
function refineIntegrations(raw: Record<string, unknown>, ctx: z.RefinementCtx): void {
  requireCompletePairs(raw, ctx);
  requireKeysForFlags(raw, ctx);
}

/** Refuses a half-configured pair; the issue names the missing variable only, never a value. */
function requireCompletePairs(raw: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const pair of INTEGRATION_PAIRS) {
    const present = pair.filter((name) => raw[name] !== undefined);
    if (present.length === 0 || present.length === pair.length) continue;
    for (const name of pair) {
      if (raw[name] === undefined) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'required with its pair' });
      }
    }
  }
}

const baseFields = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  SENTRY_DSN: z.string().min(1).optional(),
  // Only the worker connects to Redis (DT-169): optional here, required when dist/worker.js boots.
  REDIS_URL: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_JWT_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  SHARE_IP_SALT: z.string().min(32),
  SHARE_UNLOCK_SECRET: z.string().min(32),
  THROTTLE_TTL: z.coerce.number().int().min(1).default(60),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(60),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  ...integrationFields,
  ...featureFields,
};

export const envSchema = z.object(baseFields).superRefine(refineIntegrations);

export type AppConfig = z.infer<typeof envSchema>;

/**
 * The worker's environment (DT-181 9a, DT-191): no Clerk variable; Redis is required; Cloudinary and `SHARE_*`
 * stay because the file cleanup and share-link steps use them; the integration pairs are optional.
 */
export const workerEnvSchema = z
  .object({
    NODE_ENV: baseFields.NODE_ENV,
    APP_URL: baseFields.APP_URL,
    DATABASE_URL: baseFields.DATABASE_URL,
    SENTRY_DSN: baseFields.SENTRY_DSN,
    REDIS_URL: z.string().min(1),
    CLOUDINARY_CLOUD_NAME: baseFields.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: baseFields.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: baseFields.CLOUDINARY_API_SECRET,
    SHARE_IP_SALT: baseFields.SHARE_IP_SALT,
    SHARE_UNLOCK_SECRET: baseFields.SHARE_UNLOCK_SECRET,
    ...integrationFields,
    ...featureFields,
  })
  .superRefine(refineIntegrations);

export type WorkerConfig = z.infer<typeof workerEnvSchema>;

export interface IntegrationsView {
  readonly stripe: { readonly secretKey: string; readonly webhookSecret: string } | null;
  readonly binance: { readonly apiKey: string; readonly apiSecret: string } | null;
}

type IntegrationConfig = Pick<
  AppConfig,
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'BINANCE_API_KEY'
  | 'BINANCE_API_SECRET'
  | 'FEATURE_STRIPE'
  | 'FEATURE_BINANCE'
>;

/**
 * Typed view of the integrations; `null` when the provider is off: its flag is not `true` or its pair is not
 * configured (DT-193, DT-227).
 */
export function integrationsOf(config: IntegrationConfig): IntegrationsView {
  const {
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    BINANCE_API_KEY,
    BINANCE_API_SECRET,
    FEATURE_STRIPE,
    FEATURE_BINANCE,
  } = config;
  return {
    stripe:
      FEATURE_STRIPE && STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET
        ? { secretKey: STRIPE_SECRET_KEY, webhookSecret: STRIPE_WEBHOOK_SECRET }
        : null,
    binance:
      FEATURE_BINANCE && BINANCE_API_KEY && BINANCE_API_SECRET
        ? { apiKey: BINANCE_API_KEY, apiSecret: BINANCE_API_SECRET }
        : null,
  };
}

export interface FeaturesView {
  readonly stripe: boolean;
  readonly binance: boolean;
  readonly bankSync: boolean;
}

/**
 * The effective feature flags the FE reads from `GET /features` (DT-227). `bankSync` is the flag alone: no bank
 * adapter exists yet (DT-186), so nothing binds to it today.
 */
export function featuresOf(config: IntegrationConfig & Pick<AppConfig, 'FEATURE_BANK_SYNC'>): FeaturesView {
  const view = integrationsOf(config);
  return {
    stripe: view.stripe !== null,
    binance: view.binance !== null,
    bankSync: config.FEATURE_BANK_SYNC,
  };
}

export class InvalidEnvError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(`Invalid or missing environment variables: ${names.join(', ')}`);
    this.name = 'InvalidEnvError';
    this.names = names;
  }
}

function invalidNames(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? 'unknown')))];
}

/** Validates the raw environment. Failures expose variable names only, never values. */
export function parseEnv(raw: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new InvalidEnvError(invalidNames(result.error));
}

/** Same contract as `parseEnv` for the worker process. */
export function parseWorkerEnv(raw: Record<string, string | undefined>): WorkerConfig {
  const result = workerEnvSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new InvalidEnvError(invalidNames(result.error));
}
