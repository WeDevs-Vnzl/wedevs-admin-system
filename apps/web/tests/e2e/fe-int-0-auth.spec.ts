import { expect, test } from "@playwright/test";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import { OWNER_NAME_ENV, requireEnv } from "./support/roles";

// FE-INT-0 package 0.5 (docs/TASK.md). Titles carry the project tag: `@unauthenticated` runs in the `unauthenticated`
// project (agents, no Clerk keys, DT-204); `@authenticated` runs in the `authenticated` project (the user, locally).
// The BE is checked first: this file needs the local BE up (apps/api), started by the Tester outside this worker.

const UNKNOWN_PORTAL_TOKEN = "e2e-unknown-portal-token";

test.describe("FE-INT-0 auth harness", () => {
  test.beforeAll(async () => {
    await assertBackendHealthy();
  });

  test("@unauthenticated /dashboard redirects to /sign-in without a session", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("@unauthenticated portal page and API share route are reachable without a session", async ({
    page,
    request,
  }) => {
    await page.goto(`/s/${UNKNOWN_PORTAL_TOKEN}`);
    await expect(page).not.toHaveURL(/\/sign-in/);

    const response = await request.get(`/api/s/${UNKNOWN_PORTAL_TOKEN}`, { maxRedirects: 0 });
    const status = response.status();
    const location = response.headers().location ?? "";
    const redirectedToSignIn = status >= 300 && status < 400 && location.includes("sign-in");
    expect(redirectedToSignIn, "public API route redirected to sign-in").toBe(false);
  });

  test("@authenticated Owner signs in and the user menu shows the BE user's name", async ({
    page,
  }) => {
    const ownerName = requireEnv(OWNER_NAME_ENV);
    await signInAs(page, "OWNER");
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /^(Menú de usuario|User menu)$/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText(ownerName)).toBeVisible();
    // The menu renders the role as "<label>: <role>" in one element (user-menu.tsx).
    await expect(menu.getByText(/^(Rol|Role): (Propietario|Owner)$/)).toBeVisible();
  });
});
