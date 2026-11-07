import { defineConfig, devices } from "@playwright/test";
import { LOCAL_API_BASE_URL } from "./tests/e2e/support/backend";

// No `webServer`: the app and the local BE are started separately (safeguards.md rule 1) or the suite targets a deploy
// preview. Next reads NEXT_PUBLIC_API_BASE_URL for the browser bundle and the CSP connect-src origin (A3), so an unset
// value is defaulted here to the local BE; the FE start command must export the same value.
process.env.NEXT_PUBLIC_API_BASE_URL ??= LOCAL_API_BASE_URL;

// DT-204 (Q-FEINT-2 (A)): agents run `unauthenticated` (no Clerk keys, no signed-in user); the user runs `authenticated`
// locally with CLERK_SECRET_KEY and the E2E_* test e-mails set. Tags in the titles pick the tests of each project.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "unauthenticated",
      testMatch: /fe-int-0-auth\.spec\.ts$/,
      grep: /@unauthenticated/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Everything except the `@unauthenticated` titles: the legacy mock-backed specs and the `@authenticated` tests.
      name: "authenticated",
      grepInvert: /@unauthenticated/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
