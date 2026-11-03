import { request } from "@playwright/test";

// Harness for the local BE (apps/api). Nothing here starts the BE, Postgres or the FE: the Tester starts them
// outside the browser worker (safeguards.md rule 1), with explicit timeouts, and stops them after the run.

/**
 * Default origin of the local BE. The BE's own `PORT` defaults to 3000, the same as the FE's default
 * `PLAYWRIGHT_BASE_URL`, so the Tester starts the BE on another free port and exports the matching
 * `NEXT_PUBLIC_API_BASE_URL` to the FE start command (safeguards.md rule 2).
 */
export const LOCAL_API_BASE_URL = "http://localhost:3001";

/** Public health route of the BE: `GET /api/v1/health` (global prefix `api`, URI versioning, default version 1). */
export const BACKEND_HEALTH_PATH = "/api/v1/health";

const PROBE_TIMEOUT_MS = 10_000;

/**
 * The BE origin the E2E run targets. `playwright.config.ts` sets `NEXT_PUBLIC_API_BASE_URL` to the local BE when it
 * is unset: Next reads it for the browser bundle and for the CSP `connect-src` origin (`next.config.ts`), and an
 * unset value drops the BE origin from the CSP.
 */
export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.NEXT_PUBLIC_API_BASE_URL || LOCAL_API_BASE_URL;
}

/**
 * Fails fast with a readable message when the local BE does not answer its health route. Uses Playwright's request
 * context, not a global `fetch`, so the probe is never mistaken for a hand-written BE call in app code (C7).
 */
export async function assertBackendHealthy(baseUrl: string = apiBaseUrl()): Promise<void> {
  const context = await request.newContext({ baseURL: baseUrl, timeout: PROBE_TIMEOUT_MS });
  try {
    let status: number;
    try {
      const response = await context.get(BACKEND_HEALTH_PATH);
      status = response.status();
    } catch {
      throw new Error(
        `Local BE not reachable at ${baseUrl}${BACKEND_HEALTH_PATH}. Start it (apps/api, safeguards.md rule 1) before the E2E run.`,
      );
    }
    if (status !== 200) {
      throw new Error(
        `Local BE at ${baseUrl}${BACKEND_HEALTH_PATH} answered HTTP ${status}, expected 200. Check the BE and its database.`,
      );
    }
  } finally {
    await context.dispose();
  }
}

/*
 * Local `User` rows for the test users (how each role's e-mail gets its row on the BE started from `staging`).
 *
 * The seed (`apps/api/prisma/seed.ts`) creates catalogs and settings only, never users. The local `User` row is
 * created by the Clerk `user.created` event, delivered as a Svix-signed webhook to `POST /api/v1/webhooks/clerk`
 * (`sync-clerk-user.use-case.ts`). The role comes from the Clerk user's `public_metadata.role` (one of OWNER, ADMIN,
 * MEMBER, VIEWER; VIEWER when absent), so no BE change is needed for the harness:
 *
 * 1. Bootstrap the first OWNER: in the Clerk dev instance create the test user for `E2E_OWNER_EMAIL` with
 *    `public_metadata: { "role": "OWNER" }` (set by the user, in the Clerk dashboard).
 * 2. Other roles: an existing OWNER invites the e-mail through `POST /api/v1/users/invitations` with the role; the
 *    invitation carries the role in its public metadata and the webhook applies it on sign-up.
 * 3. Clerk must deliver `user.created` to the local BE. Clerk cannot reach `localhost`, so the user uses a tunnel to
 *    the local BE or replays the event from the Clerk dashboard. The row must exist before `/me` answers 200; a valid
 *    Clerk session without a local row gets `401 UNAUTHENTICATED` and the no-access redirect (Q-BE1-2).
 *
 * Only the e-mail and role setup is manual, and it is done by the user with their own Clerk dev instance (DT-204).
 */
