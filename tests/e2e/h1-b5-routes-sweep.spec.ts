import { expect, test, type Browser, type Page } from "@playwright/test";

// T9 navigation sweep, H1-B5 (odd/tasks/h1-b5-intelligence-ui.md S10): every route of PRD §11 loads without an
// error boundary, a 404 or a console error (Hito 1 completeness), plus HU-02 CA1 (only the Owner reaches
// /settings/users). `[id]` params come from the seed (src/mocks/fixtures). Known gaps (A5): /payments/[id]/edit and
// /expenses/[id]/edit have no page in H1-B5 (H1-FX items), so they are `test.fixme`. Out of the sweep:
// `/api/webhooks/clerk` and `/api/files/[id]/download` are Hito 2 only (docs/rules/coverage-matrix.md:107).
// This file starts nothing: it runs against PLAYWRIGHT_BASE_URL (safeguards.md rule 1). The mock store is one
// in-memory object per server process, so run it with `--workers=1`; the mock data is reset once before the sweep.
// Default role: Owner.

const KAIROS_TOKEN = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";

const CLIENT = "cli_kairos";
const PROJECT = "pry_kairos_web";
const INVOICE = "inv_kairos_partial";
const PAYMENT = "pag_kairos_partial";
const EXPENSE = "exp_landing_kairos";
const RECURRING_EXPENSE = "rex_suscripcion_ia";
const ACCOUNT = "acc_zelle";
const DOCUMENT = "doc_prd_kairos_web";
const VERSION = "dver_prd_kairos_web_1";
const SHARE = "shr_kairos_entrega";
const NOTE = "note_kairos_alcance";

const SETTINGS_SECTIONS = [
  "company",
  "users",
  "preferences",
  "currencies",
  "rates",
  "fiscal",
  "payment-methods",
  "technologies",
  "document-types",
  "expense-categories",
  "tags",
  "trash",
];

/** Authenticated routes of PRD §11 (Owner). */
const APP_ROUTES = [
  "/dashboard",
  "/clients",
  "/clients/list",
  "/clients/new",
  `/clients/${CLIENT}`,
  `/clients/${CLIENT}?tab=contacts`,
  `/clients/${CLIENT}/edit`,
  `/clients/${CLIENT}/graph`,
  "/projects",
  "/projects/list",
  "/projects/new",
  `/projects/${PROJECT}`,
  `/projects/${PROJECT}/edit`,
  `/projects/${PROJECT}/graph`,
  `/projects/${PROJECT}/billing`,
  "/invoices",
  "/invoices/list",
  "/invoices/new",
  `/invoices/new?clientId=${CLIENT}`,
  `/invoices/${INVOICE}`,
  `/invoices/${INVOICE}/edit`,
  `/invoices/${INVOICE}/graph`,
  "/payments",
  "/payments/list",
  "/payments/new",
  `/payments/new?invoiceId=${INVOICE}`,
  `/payments/${PAYMENT}`,
  `/payments/${PAYMENT}/graph`,
  "/expenses",
  "/expenses/list",
  "/expenses/new",
  "/expenses/recurring",
  "/expenses/recurring/new",
  `/expenses/recurring/${RECURRING_EXPENSE}`,
  `/expenses/${EXPENSE}`,
  `/expenses/${EXPENSE}/graph`,
  "/accounts",
  "/accounts/new",
  `/accounts/${ACCOUNT}`,
  `/accounts/${ACCOUNT}/edit`,
  "/accounts/transfers/new",
  "/accounts/movements/new",
  "/documents",
  "/documents/list",
  "/documents/new",
  `/documents/${DOCUMENT}`,
  `/documents/${DOCUMENT}/edit`,
  `/documents/${DOCUMENT}/graph`,
  `/documents/${DOCUMENT}/editor`,
  `/documents/${DOCUMENT}/versions/${VERSION}`,
  `/documents/${DOCUMENT}/versions/${VERSION}/compare`,
  "/documents/shares",
  `/documents/shares/${SHARE}`,
  "/notes",
  "/notes/new",
  `/notes/${NOTE}`,
  "/graph",
  "/reports",
  "/reports/billed-vs-collected",
  "/reports/taxes-registered",
  "/reports/mrr",
  "/activity",
  ...SETTINGS_SECTIONS.map((section) => `/settings/${section}`),
];

/** §11 routes without a page in H1-B5 (A5 → H1-FX). */
const KNOWN_GAPS = [`/payments/${PAYMENT}/edit`, `/expenses/${EXPENSE}/edit`];

const notFound = (page: Page) =>
  page.getByText(/^(Página no encontrada|Page not found)$/, { exact: true });

/**
 * Seed project links point at the reserved `*.example.com` domain (RFC 2606), so the browser logs a DNS failure
 * for each link favicon. That is test-data noise, not an app error: only those resource loads are ignored.
 */
const RESERVED_HOST = /^https?:\/\/([a-z0-9-]+\.)*example\.com\//;

/** Records uncaught page errors and console errors from the moment it is called. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location().url;
    if (message.text().startsWith("Failed to load resource") && RESERVED_HOST.test(source)) return;
    errors.push(`console: ${message.text()} (${source})`);
  });
  return errors;
}

/** Loads `path` and asserts no 404, no server error, no error overlay and no console error. */
async function expectRouteLoads(page: Page, path: string) {
  const errors = watchErrors(page);
  const response = await page.goto(path);
  await page.waitForLoadState("networkidle");
  expect(response?.status(), `${path} status`).toBeLessThan(400);
  await expect(notFound(page), `${path} not found`).toHaveCount(0);
  await expect(page.locator("main, body").first()).toBeVisible();
  // Next's dev overlay renders runtime errors in its portal: there must be no error dialog.
  await expect(
    page.locator("nextjs-portal").getByText(/Unhandled Runtime Error|Runtime Error|Build Error/),
  ).toHaveCount(0);
  expect(errors, `${path} errors`).toEqual([]);
}

async function resetMockData(browser: Browser) {
  const page = await browser.newPage();
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^(Menú de usuario|User menu)$/ }).click();
  await page
    .getByRole("menuitem", { name: /^(Restablecer datos de prueba|Reset mock data)$/ })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^(Restablecer|Reset)$/ })
    .click();
  await expect(page.getByText(/Datos de prueba restablecidos|Mock data reset/)).toBeVisible();
  await page.close();
}

/** Sets the MOCK role of this context through "Ver como rol" in the user menu (cookie only). */
async function viewAsRole(page: Page, role: "Administrador" | "Miembro" | "Lector") {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Ver como rol" }).hover();
  await page.getByRole("menuitemradio", { name: role, exact: true }).click();
  await expect(page.getByText(`Ahora ves la aplicación como ${role}`)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  await resetMockData(browser);
});

test.describe("PRD §11 routes (Owner)", () => {
  for (const path of APP_ROUTES) {
    test(`${path} loads`, async ({ page }) => {
      await expectRouteLoads(page, path);
    });
  }

  for (const path of KNOWN_GAPS) {
    // KNOWN GAP (A5): listed in PRD §11, no page in H1-B5; logged as an H1-FX item.
    test.fixme(`${path} loads (known gap A5, H1-FX)`, async ({ page }) => {
      await expectRouteLoads(page, path);
    });
  }
});

test.describe("PRD §11 public routes", () => {
  test("/sign-in loads", async ({ page }) => {
    await expectRouteLoads(page, "/sign-in");
  });

  test("/s/[token] loads the portal", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.251" });
    await expectRouteLoads(page, `/s/${KAIROS_TOKEN}`);
    await expect(page.getByRole("list", { name: /^(Documentos|Documents)$/ })).toBeVisible();
  });

  test("/api/s/[token]/files/[documentId] answers a portal document", async ({ page }) => {
    const response = await page.request.get(
      `/api/s/${KAIROS_TOKEN}/files/doc_contrato_kairos?download=1`,
      { headers: { "x-forwarded-for": "198.51.100.252" }, maxRedirects: 0 },
    );
    expect(response.status()).toBeLessThan(400);
  });
});

test.describe("HU-02 CA1: only the Owner sees /settings/users", () => {
  test("the Owner opens /settings/users", async ({ page }) => {
    await expectRouteLoads(page, "/settings/users");
    await expect(notFound(page)).toHaveCount(0);
  });

  for (const role of ["Administrador", "Miembro", "Lector"] as const) {
    test(`${role} gets a 404 on /settings/users`, async ({ page }) => {
      await viewAsRole(page, role);
      const response = await page.goto("/settings/users");
      await page.waitForLoadState("networkidle");
      expect(response?.status()).toBe(404);
      await expect(notFound(page)).toBeVisible();
    });
  }
});
