import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import { appBaseUrl } from "./support/app";
import { assertBackendHealthy } from "./support/backend";
import { roleEmail } from "./support/roles";

// FE-INT-R E.0 identity E2E (HU-01 CA3, HU-02 CA1–CA2, HU-27 CA1, HU-30, company logo, personal access tokens).
// Titles carry the project tag: `@unauthenticated` runs in the `unauthenticated` project (no Clerk keys, DT-204);
// `@authenticated` runs in the `authenticated` project, which the user runs locally against the local BE.
//
// The authenticated tests change state the other tests read (the Admin test user's role, the Owner's preferences and
// column layout). Each restores its value; run the authenticated project with `--workers=1` to keep them apart.
// Every label accepts both locales (es and en), as the rest of the suite does. The personal access token copy is
// `apiTokens.json` (FE-INT-R 6.2): the labels in API_TOKEN_COPY are provisional until that file is on the branch.

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const API_TOKEN_COPY = {
  nav: /^(Tokens de API|API tokens)$/,
  create: /^(Crear token|Create token|Nuevo token|New token)$/,
  // Labels from apiTokens.json (es/en): form submit, secret dialog close, row action "Revocar {name}", confirm.
  submit: /^(Crear token|Create token)$/,
  done: /^(Ya lo guardé|I have stored it)$/,
  revokeRow: /^(Revocar|Revoke) /,
  revoke: /^(Revocar|Revoke)$/,
} as const;

interface Session {
  context: BrowserContext;
  page: Page;
}

/** Matches one of the labels exactly, in any of the given locales. */
function oneOf(...labels: string[]): RegExp {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(${escaped.join("|")})$`);
}

/** A fresh browser context, so the next sign-in starts with no cookies, storage or preference cache. */
async function openSession(browser: Browser): Promise<Session> {
  const context = await browser.newContext({ baseURL: appBaseUrl() });
  return { context, page: await context.newPage() };
}

/** Sets one user's role from the users table (Owner only). Waits until the control shows the new role. */
async function setRowRole(page: Page, email: string, roleLabel: RegExp): Promise<void> {
  const row = page.getByRole("row").filter({ hasText: email });
  const control = row.getByRole("combobox", { name: /^(Rol de |Role of )/ });
  await control.click();
  await page.getByRole("option", { name: roleLabel }).click();
  await expect(control).toHaveText(roleLabel);
}

/** The column headers of the visible table, in order. */
async function columnOrder(page: Page): Promise<string[]> {
  return page.getByRole("columnheader").allInnerTexts();
}

test.describe("FE-INT-1 identity", () => {
  test.beforeAll(async () => {
    await assertBackendHealthy();
  });

  test("@unauthenticated HU-01 CA3: Settings → Usuarios without a session goes to sign-in", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("@authenticated HU-02 CA1: the Owner sees Usuarios, invites a user and revokes the invitation", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    await page.goto("/settings/users");
    await expect(page.getByRole("heading", { name: oneOf("Usuarios", "Users") })).toBeVisible();

    const email = `e2e-invite-${Date.now()}@example.com`;
    await page.getByRole("button", { name: oneOf("Invitar usuario", "Invite user") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(oneOf("Correo", "E-mail")).fill(email);
    await dialog.getByRole("button", { name: oneOf("Enviar invitación", "Send invitation") }).click();
    await expect(page.getByText(oneOf(`Invitación enviada a ${email}`, `Invitation sent to ${email}`))).toBeVisible();

    const invitation = page.getByRole("row").filter({ hasText: email });
    await invitation
      .getByRole("button", { name: oneOf(`Revocar la invitación de ${email}`, `Revoke the invitation of ${email}`) })
      .click();
    await expect(page.getByText(oneOf("Invitación revocada", "Invitation revoked"))).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
  });

  test.describe("role change of the Admin test user", () => {
    test.describe.configure({ mode: "serial" });

    test("@authenticated HU-02 CA1: the Owner changes a role and restores it", async ({ page }) => {
      const adminEmail = roleEmail("ADMIN");
      await signInAs(page, "OWNER");
      await page.goto("/settings/users");
      try {
        await setRowRole(page, adminEmail, oneOf("Miembro", "Member"));
      } finally {
        await setRowRole(page, adminEmail, oneOf("Administrador", "Admin"));
      }
    });
  });

  // HU-02 CA1: only the Owner sees the section; the page answers the in-shell not-found (FORBIDDEN → notFound()).
  // CA2 (a direct financial action answering FORBIDDEN) is covered over the API by E.1 in W5.
  test("@authenticated HU-02 CA1: a Member opening /settings/users gets the not-found page and no invite action", async ({
    page,
  }) => {
    await signInAs(page, "MEMBER");
    await page.goto("/settings/users");
    await expect(page.getByText(oneOf("Página no encontrada", "Page not found"))).toBeVisible();
    await expect(page.getByRole("button", { name: oneOf("Invitar usuario", "Invite user") })).toHaveCount(0);
  });

  test("@authenticated HU-30: language and theme persist across a new session", async ({ browser }) => {
    const first = await openSession(browser);
    const second = await openSession(browser);
    try {
      await signInAs(first.page, "OWNER");
      await first.page.goto("/settings/preferences");
      await first.page.getByLabel("English").check();
      await first.page.getByLabel(oneOf("Oscuro", "Dark")).check();
      await first.page.getByRole("button", { name: oneOf("Guardar cambios", "Save changes") }).click();
      await expect(first.page.locator("html")).toHaveAttribute("lang", "en");

      await signInAs(second.page, "OWNER");
      await expect(second.page.locator("html")).toHaveAttribute("lang", "en");
      await expect(second.page.locator("html")).toHaveClass(/\bdark\b/);
    } finally {
      await second.page.goto("/settings/preferences");
      await second.page.getByLabel("Español").check();
      await second.page.getByLabel(oneOf("Claro", "Light")).check();
      await second.page.getByRole("button", { name: oneOf("Guardar cambios", "Save changes") }).click();
      await expect(second.page.locator("html")).toHaveAttribute("lang", "es");
      await first.context.close();
      await second.context.close();
    }
  });

  test("@authenticated HU-27 CA1: a table column layout persists across a new session", async ({ browser }) => {
    const first = await openSession(browser);
    const second = await openSession(browser);
    const moveTradeNameDown = oneOf("Move Trade name down", "Mover Nombre comercial hacia abajo");
    try {
      await signInAs(first.page, "OWNER");
      await first.page.goto("/clients/list");
      await first.page.getByRole("button", { name: oneOf("Columns", "Columnas") }).click();
      const defaultOrder = await columnOrder(first.page);
      await first.page.getByRole("button", { name: moveTradeNameDown }).click();
      const layout = await columnOrder(first.page);
      expect(layout).not.toEqual(defaultOrder);
      await first.page.keyboard.press("Escape");

      await signInAs(second.page, "OWNER");
      await second.page.goto("/clients/list");
      await expect.poll(() => columnOrder(second.page)).toEqual(layout);
    } finally {
      await second.page.goto("/clients/list");
      await second.page.getByRole("button", { name: oneOf("Columns", "Columnas") }).click();
      await second.page.getByRole("button", { name: oneOf("Reset columns", "Restablecer columnas") }).click();
      await first.context.close();
      await second.context.close();
    }
  });

  test("@authenticated company logo upload is visible after the BE confirms it (Cloudinary stubbed)", async ({
    page,
  }) => {
    // Cloudinary is never called live: the signed upload and the download redirect are answered with a 1×1 PNG.
    await page.route(/cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
    );
    await signInAs(page, "OWNER");
    await page.goto("/settings/company");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await page.getByRole("button", { name: oneOf("Guardar", "Save") }).click();
    await expect(page.getByText(oneOf("Perfil de la empresa guardado", "Company profile saved"))).toBeVisible();
    await expect(
      page.getByText(
        oneOf("Hay un logo cargado. Sube uno nuevo para reemplazarlo.", "A logo is set. Upload a new one to replace it."),
      ),
    ).toBeVisible();
    await expect(page.locator('img[src*="/files/"]').first()).toBeVisible();
  });

  test("@authenticated /settings/api-tokens: create shows the secret once, then revoke", async ({ page }) => {
    const tokenName = `e2e-token-${Date.now()}`;
    await signInAs(page, "VIEWER");
    await page.goto("/settings/api-tokens");
    await page.getByRole("button", { name: API_TOKEN_COPY.create }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel(oneOf("Nombre", "Name")).fill(tokenName);
    await form.getByRole("button", { name: API_TOKEN_COPY.submit }).click();

    const secretDialog = page.getByRole("dialog");
    const secret = await secretDialog
      .locator("code, input[readonly]")
      .first()
      .evaluate((element) => (element instanceof HTMLInputElement ? element.value : (element.textContent ?? "")));
    expect(secret.length).toBeGreaterThan(0);
    await secretDialog.getByRole("button", { name: API_TOKEN_COPY.done }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(secret)).toHaveCount(0);
    expect(page.url()).not.toContain(secret);

    const row = page.getByRole("row").filter({ hasText: tokenName });
    await row.getByRole("button", { name: API_TOKEN_COPY.revokeRow }).click();
    const confirmation = page.getByRole("alertdialog");
    if ((await confirmation.count()) > 0) {
      await confirmation.getByRole("button", { name: API_TOKEN_COPY.revoke }).click();
    }
    await expect(page.getByRole("row").filter({ hasText: tokenName })).toContainText(/Revocad|Revoked/);
  });
});
