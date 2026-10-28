import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  SENTRY_DSN: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_JWT_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
});

export type AppConfig = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(`Invalid or missing environment variables: ${names.join(', ')}`);
    this.name = 'InvalidEnvError';
    this.names = names;
  }
}

/** Validates the raw environment. Failures expose variable names only, never values. */
export function parseEnv(raw: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;
  const names = [
    ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? 'unknown'))),
  ];
  throw new InvalidEnvError(names);
}
