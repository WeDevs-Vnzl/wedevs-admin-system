import { generateKeyPairSync } from 'node:crypto';

/** A throwaway public key generated per process; the matching private key is discarded at once. */
const throwawayPublicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .publicKey.export({ type: 'spki', format: 'pem' })
  .toString();

/**
 * Obviously fake, non-secret values for the Clerk and Cloudinary env names (C5). Never real keys; the
 * tests stub the HTTP layer and sign their own JWTs and webhooks.
 */
export const TEST_ENV: Readonly<Record<string, string>> = {
  CLERK_SECRET_KEY: 'sk_test_fake_not_a_real_key',
  CLERK_PUBLISHABLE_KEY: 'pk_test_fake_not_a_real_key',
  CLERK_JWT_KEY: throwawayPublicKey,
  CLERK_WEBHOOK_SECRET: 'whsec_ZmFrZS1ub3QtYS1yZWFsLXNlY3JldA==',
  CLOUDINARY_CLOUD_NAME: 'fake-cloud',
  CLOUDINARY_API_KEY: '000000000000000',
  CLOUDINARY_API_SECRET: 'fake-cloudinary-secret-not-real',
};

/** Puts the fake values into `process.env` (overriding whatever was there, so no real key can leak in). */
export function applyTestEnv(): void {
  for (const [name, value] of Object.entries(TEST_ENV)) process.env[name] = value;
}
