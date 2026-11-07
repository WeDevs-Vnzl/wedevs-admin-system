import { clerkSetup } from "@clerk/testing/playwright";
import { appBaseUrl } from "./app";
import { syncTestRoles } from "./role-setup";

/**
 * Runs once before any project (`playwright.config.ts` `globalSetup`). Clerk testing setup fetches a testing token
 * with the secret key, which agents never hold (DT-204). Without `CLERK_SECRET_KEY` the setup is skipped, so the
 * `unauthenticated` project runs with no Clerk keys; `signInAs` fails fast with a clear message when it needs them.
 * With the key, the Admin, Member and Viewer test users get their BE roles (idempotent, `role-setup.ts`).
 * The key value is never read into code, logged or committed.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) return;
  await clerkSetup();
  await syncTestRoles(appBaseUrl());
}
