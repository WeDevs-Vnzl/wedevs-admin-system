import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import { requireEnv, roleEmail, type TestRole } from "./roles";

/**
 * Signs the page in as the Clerk test user of `role` (DT-204). Used only by the `authenticated` project, which the
 * user runs locally. Agents run the `unauthenticated` project and never reach this function.
 *
 * `clerk.signIn` with an e-mail uses a Clerk sign-in ticket and calls the testing-token setup itself, so bot
 * protection is bypassed without a separate `setupClerkTestingToken` call. It needs Clerk to be loaded on the page,
 * so the page first opens `/sign-in`, which is a public route (`proxy.ts`).
 *
 * The Clerk secret key is read by the Clerk helpers from the environment; this file never reads or prints its value.
 */
export async function signInAs(page: Page, role: TestRole): Promise<void> {
  requireEnv("CLERK_SECRET_KEY");
  const emailAddress = roleEmail(role);
  await page.goto("/sign-in");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress });
}
