import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { appBaseUrl } from "./support/app";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import {
  createClientViaUi,
  createInvoiceViaUi,
  createProjectViaUi,
  openPage,
} from "./support/ui-data";

// T9 E2E, H1-B5 intelligence (odd/tasks/h1-b5-intelligence-ui.md S10), FE-INT-R E.3: HU-25 CA1-CA2 on /graph, HU-26
// CA1-CA3 in Cmd+K, HU-28 CA1 (archive hides a record from the table, the search and the graph unless "Mostrar
// archivados", then restore from /settings/trash) and HU-31 CA2 (the reports date range updates the cards and
// charts). The HU-24 entity-graph cases and the graph keyboard alternative moved to
// `fe-int-5-intelligence.spec.ts`, which also covers the alerts and the CSV export. HU-25 CA3 (>= 50 fps with 500
// nodes) is a manual check (A3) and is not automated here.
// Runs in the `authenticated` project (the Owner, through the Clerk test user, DT-204) against the local BE
// (safeguards.md rule 1); nothing here starts a server. The mock reset is gone: every record is created through the
// UI with a unique name (W5 rule 29): one graph client and one project per run, plus the clients each case needs.
// Copy is Spanish (the Owner's default locale).

const RUN = Date.now();

interface Fixture {
  client: { id: string; name: string };
  project: { id: string; name: string };
}

let fixture: Fixture;

const rootNode = () => `CLIENT:${fixture.client.id}`;
const canvasNode = (page: Page, id: string) => page.getByTestId(`graph-node-${id}`);
const sidePanel = (page: Page) =>
  page.getByRole("region", { name: /^(Nodo seleccionado|Selected node)$/ });

async function openGraph(page: Page, path: string, rootId: string) {
  await openPage(page, path);
  await expect(canvasNode(page, rootId)).toBeVisible({ timeout: 15_000 });
}

/** Opens the graph filters popover and returns it. */
async function openGraphFilters(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^(Filtros|Filters)$/ }).click();
  const popover = page.locator('[data-slot="popover-content"]');
  await expect(popover).toBeVisible();
  return popover;
}

/** Opens Cmd+K and types `query` into its combobox. */
async function searchCmdK(page: Page, query: string): Promise<Locator> {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill(query);
  return dialog;
}

async function arrange(browser: Browser): Promise<Fixture> {
  const context = await browser.newContext({ baseURL: appBaseUrl() });
  const page = await context.newPage();
  try {
    await signInAs(page, "OWNER");
    const name = `E2E Grafo global ${RUN}`;
    const id = await createClientViaUi(page, name, `E2E-GG-${RUN}`);
    const projectName = `E2E Proyecto global ${RUN}`;
    const projectId = await createProjectViaUi(page, {
      name: projectName,
      clients: [{ clientName: name, role: "Contratante" }],
    });
    return { client: { id, name }, project: { id: projectId, name: projectName } };
  } finally {
    await context.close();
  }
}

test.describe("H1-B5 intelligence", () => {
  test.beforeAll(async ({ browser }) => {
    await assertBackendHealthy();
    fixture = await arrange(browser);
  });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  // ───────────────────────────── HU-25 · global graph ─────────────────────────────

  test("HU-25 CA1: /graph shows clients and projects by default with the force layout", async ({
    page,
  }) => {
    await openGraph(page, "/graph", rootNode());
    for (const type of ["CLIENT", "PROJECT"]) {
      await expect(page.locator(`[data-testid^="graph-node-${type}:"]`).first()).toBeVisible();
    }
    for (const type of ["CONTACT", "INVOICE", "PAYMENT", "EXPENSE", "NOTE"]) {
      await expect(page.locator(`[data-testid^="graph-node-${type}:"]`), type).toHaveCount(0);
    }
    await expect(page.getByRole("radio", { name: /^(Fuerzas|Force)$/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Clients, projects and documents are the types on by default (documents may be none on a fresh database).
    const filters = await openGraphFilters(page);
    for (const label of ["(Clientes|Clients)", "(Proyectos|Projects)", "(Documentos|Documents)"]) {
      await expect(
        filters.getByRole("checkbox", { name: new RegExp(`^${label} \\(\\d+\\)$`) }),
      ).toBeChecked();
    }
  });

  test("HU-25 CA2: searching a name centers and highlights that node", async ({ page }) => {
    await openGraph(page, "/graph", rootNode());
    const viewport = page.locator(".react-flow__viewport");
    const before = await viewport.getAttribute("style");

    await page.getByLabel(/^(Buscar en el grafo|Search the graph)$/).fill(fixture.client.name);
    await page
      .getByRole("toolbar", { name: /^(Herramientas del grafo|Graph tools)$/ })
      .getByRole("button", { name: /^(Buscar|Search)$/ })
      .click();
    await expect(page.getByText(`Centrado en ${fixture.client.name}.`)).toBeVisible();
    await expect(canvasNode(page, rootNode())).toHaveAttribute("data-highlighted", "true");
    await expect.poll(async () => viewport.getAttribute("style")).not.toBe(before);
    await expect(
      sidePanel(page).getByRole("link", { name: /^(Ver desde aquí|View from here)$/ }),
    ).toHaveAttribute("href", `/clients/${fixture.client.id}/graph`);
  });

  // ───────────────────────────── HU-26 · Cmd+K ─────────────────────────────

  test('HU-26 CA1: searching "garcia" finds "García" (ignores accents)', async ({ page }) => {
    const name = `Talleres García ${RUN}`;
    await createClientViaUi(page, name, `E2E-HU26-1-${RUN}`);
    await openPage(page, "/dashboard");
    const dialog = await searchCmdK(page, "garcia");
    await expect(dialog.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  });

  test('HU-26 CA2: searching "invsion" finds "Inversión" (trigram similarity)', async ({ page }) => {
    const name = `Grupo Inversión ${RUN}`;
    await createClientViaUi(page, name, `E2E-HU26-2-${RUN}`);
    await openPage(page, "/dashboard");
    const dialog = await searchCmdK(page, "invsion");
    await expect(dialog.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  });

  test("HU-26 CA3: searching an invoice code goes straight to that invoice", async ({ page }) => {
    const invoice = await createInvoiceViaUi(page, {
      clientName: fixture.client.name,
      invoiceNumber: `E2E-H1B5-${Date.now()}`,
      price: "10",
    });
    // The detail header shows the number; the internal code (FAC-nnnn) sits in its description.
    const code = /FAC-\d+/.exec(await page.locator("main").innerText())?.[0];
    expect(code, "invoice code on the detail").toBeTruthy();

    await openPage(page, "/dashboard");
    const dialog = await searchCmdK(page, code ?? "");
    const option = dialog.getByRole("option", { name: new RegExp(code ?? "") }).first();
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  // ───────────────────────────── HU-28 · archive and trash ─────────────────────────────

  test('HU-28 CA1: an archived client leaves the table, the search and the graph unless "Mostrar archivados"; it is restored from the trash', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const name = `E2E Archivable H1B5 ${RUN}`;
    const id = await createClientViaUi(page, name, `E2E-H1B5-ARC-${RUN}`);
    await page.getByRole("button", { name: "Más acciones", exact: true }).click();
    await page.getByRole("menuitem", { name: "Archivar cliente", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Archivar", exact: true })
      .click();
    await expect(page.getByText("1 cliente archivado", { exact: true })).toBeVisible();

    // Table: hidden, then shown by "Mostrar archivados".
    await openPage(page, "/clients/list");
    const tableSearch = page.getByRole("searchbox", { name: "Buscar en la tabla", exact: true });
    await tableSearch.fill(name);
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
    await page.getByRole("switch", { name: "Mostrar archivados", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();

    // Search: Cmd+K does not list it.
    await openPage(page, "/dashboard");
    const dialog = await searchCmdK(page, name);
    await expect(dialog.getByRole("option", { name: new RegExp(name) })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Graph: hidden from /graph, shown by "Mostrar archivados" in the filters.
    await openGraph(page, "/graph", rootNode());
    await expect(canvasNode(page, `CLIENT:${id}`)).toHaveCount(0);
    const filters = await openGraphFilters(page);
    await filters.getByRole("switch", { name: /^(Mostrar archivados|Show archived)$/ }).click();
    await expect(canvasNode(page, `CLIENT:${id}`)).toBeVisible();

    // Restore from Configuración → Papelera: it comes back to the table and the search.
    await openPage(page, "/settings/trash");
    await page.getByRole("button", { name: `Restaurar ${name}`, exact: true }).click();
    await expect(page.getByText(`${name} restaurado`)).toBeVisible();
    await openPage(page, "/clients/list");
    await page.getByRole("searchbox", { name: "Buscar en la tabla", exact: true }).fill(name);
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
    const again = await searchCmdK(page, name);
    await expect(again.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  });

  // ───────────────────────────── HU-31 · reports range ─────────────────────────────

  /** The sparkline periods (YYYY-MM) of every KPI card. */
  async function kpiSparklines(page: Page): Promise<string[][]> {
    const list = page.getByRole("list", { name: "KPI", exact: true });
    const cards = list.locator(":scope > li");
    const count = await cards.count();
    const result: string[][] = [];
    for (let i = 0; i < count; i += 1) {
      const points = cards
        .nth(i)
        .getByRole("list", { name: /^(Últimos 12 meses|Last 12 months)$/ })
        .getByRole("listitem");
      result.push((await points.allTextContents()).map((text) => text.slice(0, 7)));
    }
    return result;
  }

  test("HU-31 CA2: changing the date range updates every KPI card and the report charts", async ({
    page,
  }) => {
    await openPage(page, "/reports");
    const cards = page.getByRole("list", { name: "KPI", exact: true }).locator(":scope > li");
    await expect(cards.first()).toBeVisible();
    const before = await kpiSparklines(page);
    expect(before.length).toBeGreaterThan(0);

    await page.getByRole("radio", { name: /^(Mes anterior|Previous month)$/ }).click();
    await expect(page).toHaveURL(/preset=PREVIOUS_MONTH/);
    await expect
      .poll(async () => JSON.stringify(await kpiSparklines(page)))
      .not.toBe(JSON.stringify(before));
    const count = await cards.count();
    for (let i = 0; i < count; i += 1) {
      await expect(cards.nth(i).getByRole("link").first()).toHaveAttribute(
        "href",
        /\?preset=PREVIOUS_MONTH/,
      );
    }

    // A report page: the chart follows the range too.
    await openPage(page, "/reports/billed-vs-collected");
    const figure = page.getByRole("figure", {
      name: /^(Facturado frente a cobrado|Billed vs collected)$/,
    });
    const points = figure.getByRole("listitem");
    await expect(points).toHaveCount(12);
    const chartBefore = await points.allTextContents();
    await page.getByRole("radio", { name: /^(Trimestre|Quarter)$/ }).click();
    await expect
      .poll(async () => JSON.stringify(await points.allTextContents()))
      .not.toBe(JSON.stringify(chartBefore));
    expect(await points.count()).toBeLessThan(12);
  });
});
