import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import { roleEmail, type TestRole } from "./roles";

/**
 * Signs the page in as the Clerk test user of `role` (DT-204). Used only by the `authenticated` project, which the
 * user runs locally. Agents run the `unauthenticated` project and never reach this function.
 *
 * `clerk.signIn` with an e-mail uses a Clerk sign-in ticket and calls the testing-token setup itself, so bot
 * protection is bypassed without a separate `setupClerkTestingToken` call. It needs Clerk to be loaded on the page,
 * so the page first opens `/sign-in`, which is a public route (`proxy.ts`).
 *
 * The Clerk secret key is read by the Clerk helpers from the environment; this file only checks that it is set and
 * never reads or prints its value. The page ends on `/dashboard` inside the shell, as the legacy helper did.
 */
export async function signInAs(page: Page, role: TestRole): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("Environment variable CLERK_SECRET_KEY is not set (E2E authenticated project, DT-204)");
  }
  const emailAddress = roleEmail(role);
  await page.goto("/sign-in");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress });
  await page.goto("/dashboard");
}
