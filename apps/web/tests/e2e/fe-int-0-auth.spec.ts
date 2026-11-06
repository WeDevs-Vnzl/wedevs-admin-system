import { expect, test } from "@playwright/test";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import { OWNER_NAME_ENV, requireEnv } from "./support/roles";

// FE-INT-0 package 0.5 (docs/TASK.md). Titles carry the project tag: `@unauthenticated` runs in the `unauthenticated`
// project (CI, and agents against the user's running FE; no signed-in user, DT-204, DT-214); `@authenticated` runs
// in the `authenticated` project (the user, locally).
// The BE is checked first: this file needs the local BE up (apps/api), started by the Tester outside this worker.

const UNKNOWN_PORTAL_TOKEN = "e2e-unknown-portal-token";
const UNKNOWN_DOCUMENT_ID = "e2e-unknown-document";

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
    // An unknown token answers the generic 404 (C22), never a sign-in redirect nor a server error.
    const pageResponse = await page.goto(`/s/${UNKNOWN_PORTAL_TOKEN}`);
    await expect(page).not.toHaveURL(/\/sign-in/);
    expect(pageResponse?.status(), "portal page status").toBe(404);

    const response = await request.get(
      `/api/s/${UNKNOWN_PORTAL_TOKEN}/files/${UNKNOWN_DOCUMENT_ID}`,
      { maxRedirects: 0 },
    );
    expect(response.status(), "portal file route status").toBe(404);
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
