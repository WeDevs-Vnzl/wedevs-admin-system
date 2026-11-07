import { expect, test, type Browser, type Page } from "@playwright/test";
import { appBaseUrl } from "./support/app";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import {
  createAccountViaUi,
  createClientViaUi,
  createDocumentViaUi,
  createExpenseViaUi,
  createInvoiceViaUi,
  createNoteViaUi,
  createProjectViaUi,
  createRecurringExpenseViaUi,
  createUsdPaymentViaUi,
  openPage,
} from "./support/ui-data";

// T9 navigation sweep, H1-B5 (odd/tasks/h1-b5-intelligence-ui.md S10), FE-INT-R E.3: every route of PRD §11 loads
// without an error boundary, a 404 or a console error (Hito 1 completeness), plus HU-02 CA1 (only the Owner reaches
// /settings/users). The `[id]` params come from records the sweep creates through the UI (W5 rule 29): one client,
// project, invoice, account, payment, expense, recurring expense, markdown document with two published versions, a
// portal share and a note, all with the run's unique names. `/payments/[id]/edit` and `/expenses/[id]/edit` exist
// (DT-213, closing the A5 gap) and are part of the sweep. Out of the sweep: `/api/webhooks/clerk` and
// `/api/files/[id]/download` (BE routes). The portal with a real token and its file download are E.2's cases (HU-22
// CA6); here only the public routes and the generic not-found of an unknown token run, tagged `@unauthenticated`.
// Runs against PLAYWRIGHT_BASE_URL with the local BE (safeguards.md rule 1); nothing here starts a server.
// Default role: Owner, through the Clerk test user (DT-204).

const RUN = Date.now();

/** The ids the sweep creates; route templates name them as `{client}`, `{project}`, … */
interface Ids {
  client: string;
  project: string;
  invoice: string;
  account: string;
  payment: string;
  expense: string;
  recurring: string;
  document: string;
  version: string;
  share: string;
  note: string;
}

let ids: Ids;

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
  "api-tokens",
  "integrations",
];

/** Authenticated routes of PRD §11 (Owner), as templates: `{name}` is replaced by the id the sweep created. */
const APP_ROUTES = [
  "/dashboard",
  "/clients",
  "/clients/list",
  "/clients/new",
  "/clients/{client}",
  "/clients/{client}?tab=contacts",
  "/clients/{client}/edit",
  "/clients/{client}/graph",
  "/projects",
  "/projects/list",
  "/projects/new",
  "/projects/{project}",
  "/projects/{project}/edit",
  "/projects/{project}/graph",
  "/projects/{project}/billing",
  "/invoices",
  "/invoices/list",
  "/invoices/new",
  "/invoices/new?clientId={client}",
  "/invoices/{invoice}",
  "/invoices/{invoice}/edit",
  "/invoices/{invoice}/graph",
  "/payments",
  "/payments/list",
  "/payments/new",
  "/payments/new?invoiceId={invoice}",
  "/payments/{payment}",
  "/payments/{payment}/edit",
  "/payments/{payment}/graph",
  "/expenses",
  "/expenses/list",
  "/expenses/new",
  "/expenses/recurring",
  "/expenses/recurring/new",
  "/expenses/recurring/{recurring}",
  "/expenses/{expense}",
  "/expenses/{expense}/edit",
  "/expenses/{expense}/graph",
  "/accounts",
  "/accounts/new",
  "/accounts/{account}",
  "/accounts/{account}/edit",
  "/accounts/transfers/new",
  "/accounts/movements/new",
  "/documents",
  "/documents/list",
  "/documents/new",
  "/documents/{document}",
  "/documents/{document}/edit",
  "/documents/{document}/graph",
  "/documents/{document}/editor",
  "/documents/{document}/versions/{version}",
  "/documents/{document}/versions/{version}/compare",
  "/documents/shares",
  "/documents/shares/{share}",
  "/notes",
  "/notes/new",
  "/notes/{note}",
  "/graph",
  "/reports",
  "/reports/billed-vs-collected",
  "/reports/taxes-registered",
  "/reports/mrr",
  "/activity",
  ...SETTINGS_SECTIONS.map((section) => `/settings/${section}`),
];

/** Replaces the `{name}` tokens of a route template with the ids created by `arrange`. */
function resolve(template: string): string {
  return template.replace(/\{(\w+)\}/g, (_token, name: keyof Ids) => ids[name]);
}

const notFound = (page: Page) =>
  page.getByText(/^(Página no encontrada|Page not found)$/, { exact: true });

/** Records uncaught page errors and console errors from the moment it is called. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    errors.push(`console: ${message.text()} (${message.location().url})`);
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

/** Publishes the next version of a markdown document from its editor (the source textbox, then "Publicar"). */
async function publishVersion(page: Page, documentId: string, version: number) {
  await openPage(page, `/documents/${documentId}/editor`);
  await page
    .getByRole("textbox", { name: /^(Fuente markdown|Markdown source)$/ })
    .fill(`# Versión ${version} ${RUN}`);
  await page
    .getByRole("button", { name: new RegExp(`^(Publicar versión v${version}|Publish version v${version})$`) })
    .click();
  const publish = page.getByRole("dialog");
  await publish.locator("#document-editor-changelog").fill(`Cambio E2E v${version}`);
  await publish.getByRole("button", { name: /^(Publicar|Publish)$/ }).click();
  await expect(page.getByText(new RegExp(`Versión v${version} publicada|Version v${version} published`))).toBeVisible();
}

/** The last path segment of the first link on the page whose href matches `pattern`, or throws. */
async function firstIdFromLinks(page: Page, pattern: RegExp, which: "first" | "last" = "first") {
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
  );
  const matches = hrefs.filter((href) => pattern.test(href));
  const href = which === "first" ? matches[0] : matches.at(-1);
  if (!href) throw new Error(`No link matching ${pattern} on ${page.url()}`);
  return href.replace(/[?#].*$/, "").split("/").pop() ?? "";
}

async function arrange(browser: Browser): Promise<Ids> {
  const context = await browser.newContext({ baseURL: appBaseUrl() });
  const page = await context.newPage();
  try {
    await signInAs(page, "OWNER");
    const clientName = `E2E Sweep ${RUN}`;
    const client = await createClientViaUi(page, clientName, `E2E-SW-${RUN}`);
    const projectName = `E2E Proyecto sweep ${RUN}`;
    const project = await createProjectViaUi(page, {
      name: projectName,
      clients: [{ clientName, role: "Contratante" }],
    });
    const invoice = (
      await createInvoiceViaUi(page, {
        clientName,
        invoiceNumber: `E2E-SW-${RUN}`,
        price: "100",
      })
    ).id;
    const accountName = `E2E Cuenta sweep ${RUN}`;
    const account = await createAccountViaUi(page, { name: accountName, currency: "USD" });
    const payment = await createUsdPaymentViaUi(page, {
      clientName,
      accountName,
      amount: "40",
      reference: `E2E-SW-${RUN}`,
    });
    const expense = await createExpenseViaUi(page, {
      description: `E2E Gasto sweep ${RUN}`,
      amount: "20",
      projectName,
    });
    const recurring = await createRecurringExpenseViaUi(page, {
      name: `E2E Recurrente sweep ${RUN}`,
      amount: "15",
    });
    const note = await createNoteViaUi(page, { clientId: client, title: `E2E Nota sweep ${RUN}` });

    // A markdown document with two published versions, so the version and compare routes have a non-current one.
    const document = await createDocumentViaUi(page, {
      title: `E2E PRD sweep ${RUN}`,
      type: "PRD",
      clientId: client,
    });
    await publishVersion(page, document, 1);
    await publishVersion(page, document, 2);
    await openPage(page, `/documents/${document}?tab=versions`);
    // The history lists the newest first: the last version link is v1.
    const version = await firstIdFromLinks(page, /\/versions\/[a-z0-9]{20,}(?:[?#].*)?$/, "last");

    // A portal share of that document.
    await openPage(page, `/documents/${document}?tab=shares`);
    await page.getByRole("button", { name: "Compartir", exact: true }).first().click();
    await page
      .getByRole("dialog", { name: "Compartir en el portal" })
      .getByRole("button", { name: "Crear enlace", exact: true })
      .click();
    await expect(page.getByText("Enlace creado")).toBeVisible();
    await openPage(page, "/documents/shares");
    const share = await firstIdFromLinks(page, /^\/documents\/shares\/[a-z0-9]{20,}$/);

    return { client, project, invoice, account, payment, expense, recurring, document, version, share, note };
  } finally {
    await context.close();
  }
}

test.describe("PRD §11 routes (Owner)", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await assertBackendHealthy();
    ids = await arrange(browser);
  });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  for (const template of APP_ROUTES) {
    test(`${template} loads`, async ({ page }) => {
      await expectRouteLoads(page, resolve(template));
    });
  }
});

test.describe("PRD §11 public routes", () => {
  test("@unauthenticated /sign-in loads", async ({ page }) => {
    await expectRouteLoads(page, "/sign-in");
  });

  // The portal with a real token and its file download are E.2's cases (HU-22 CA6, DT-224); the sweep only checks
  // that an unknown token gets the generic "Enlace no disponible" page with status 404 (PRD §8.11, C22).
  test("@unauthenticated /s/[token] with an unknown token shows the generic not-found page", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.251" });
    const response = await page.goto(`/s/e2e-sweep-unknown-${RUN}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Enlace no disponible" })).toBeVisible();
  });
});

test.describe("HU-02 CA1: only the Owner sees /settings/users", () => {
  test("the Owner opens /settings/users", async ({ page }) => {
    await signInAs(page, "OWNER");
    await expectRouteLoads(page, "/settings/users");
    await expect(notFound(page)).toHaveCount(0);
  });

  for (const [role, key] of [
    ["Administrador", "ADMIN"],
    ["Miembro", "MEMBER"],
    ["Lector", "VIEWER"],
  ] as const) {
    test(`${role} gets a 404 on /settings/users`, async ({ page }) => {
      await signInAs(page, key);
      const response = await page.goto("/settings/users");
      await page.waitForLoadState("networkidle");
      expect(response?.status()).toBe(404);
      await expect(notFound(page)).toBeVisible();
    });
  }
});
