import { expect, test, type Locator, type Page } from "@playwright/test";

// T9 E2E, H1-B5 intelligence (odd/tasks/h1-b5-intelligence-ui.md S10): HU-24 CA1-CA5 on the Kairos Studio graph,
// HU-25 CA1-CA2 on /graph, HU-26 CA1-CA3 in Cmd+K, HU-28 CA1 (archive hides a record from the table, the search
// and the graph unless "Mostrar archivados", then restore from /settings/trash) and HU-31 CA2 (the reports date
// range updates the cards and charts), plus the graph keyboard alternative (the node list). HU-25 CA3 (>= 50 fps
// with 500 nodes) is a manual check (A3) and is not automated here.
// This file starts nothing: it runs against PLAYWRIGHT_BASE_URL (safeguards.md rule 1). The mock store is one
// in-memory object per server process, so run it with `--workers=1`; every test resets the mock data first.
// Default role: Owner.
// Seed facts (src/mocks/fixtures): `cli_kairos` (Kairos Studio) has contacts, projects, invoices, payments,
// documents and notes; its projects `pry_kairos_web` (Sitio web Kairos Studio) and `pry_kairos_app` (App de reservas
// Kairos), and the app is shared with `cli_hotel_mochima`. `cli_graficas_caribe` (Gráficas Caribe) has no projects
// and no invoices. Invoices are FAC-0001..FAC-0004; FAC-0003 is `inv_kairos_overdue`. No seeded record is named
// "García" or "Inversión", so HU-26 CA1/CA2 create the clients of the PRD examples first.

const KAIROS = "CLIENT:cli_kairos";
const KAIROS_WEB = "PROJECT:pry_kairos_web";
const KAIROS_APP = "PROJECT:pry_kairos_app";
const MOCHIMA = "CLIENT:cli_hotel_mochima";
const CARIBE_ID = "cli_graficas_caribe";
const CARIBE = "Gráficas Caribe";

async function resetMockData(page: Page) {
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
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

const canvasNode = (page: Page, id: string) => page.getByTestId(`graph-node-${id}`);
const nodeList = (page: Page) => page.getByRole("list", { name: /^(Lista de nodos|Node list)$/ });
const sidePanel = (page: Page) =>
  page.getByRole("region", { name: /^(Nodo seleccionado|Selected node)$/ });

async function openGraph(page: Page, path: string, rootId: string) {
  await open(page, path);
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

/** Creates a person client in Colombia through /clients/new (address and E.164 phone are required). */
async function createClient(page: Page, tradeName: string, taxId: string) {
  await open(page, "/clients/new");
  await page.getByLabel("Nombre comercial", { exact: true }).fill(tradeName);
  await page.getByLabel("Identificador fiscal", { exact: true }).fill(taxId);
  // A Venezuelan tax id has a fixed format; Colombia accepts the free E2E id.
  await page.getByRole("combobox", { name: "País", exact: true }).click();
  await page.getByRole("option", { name: "Colombia" }).click();
  await page.getByLabel("Dirección", { exact: true }).fill("Calle E2E 1");
  await page.locator("#client-phone").fill("+57 300 123 4567");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/cli_/);
}

test.beforeEach(async ({ page }) => {
  await resetMockData(page);
});

// ───────────────────────────── HU-24 · entity graph ─────────────────────────────

test("HU-24 CA1: the client graph loads Kairos Studio as root with its direct contacts, projects, invoices, payments, documents and notes", async ({
  page,
}) => {
  await openGraph(page, "/clients/cli_kairos/graph", KAIROS);
  for (const type of ["CONTACT", "PROJECT", "INVOICE", "PAYMENT", "DOCUMENT", "NOTE"]) {
    await expect(
      page.locator(`[data-testid^="graph-node-${type}:"]`).first(),
      `${type} node on the canvas`,
    ).toBeVisible();
  }
  await expect(canvasNode(page, KAIROS_WEB)).toBeVisible();
  // The root is the starting point: it has no "+" of its own.
  await expect(
    nodeList(page).getByRole("button", { name: /^(Expandir|Expand) Kairos Studio$/ }),
  ).toHaveCount(0);
});

test("HU-24 CA2: expanding a project adds its documents, invoices, expenses and the other clients of the project", async ({
  page,
}) => {
  await openGraph(page, "/clients/cli_kairos/graph", KAIROS);
  const before = await page.locator('[data-testid^="graph-node-"]').count();

  await nodeList(page)
    .getByRole("button", { name: /^(Expandir|Expand) Sitio web Kairos Studio$/ })
    .click();
  await expect
    .poll(async () => page.locator('[data-testid^="graph-node-"]').count())
    .toBeGreaterThan(before);
  await expect(page.locator('[data-testid^="graph-node-EXPENSE:"]').first()).toBeVisible();

  // Double click on the canvas node expands too: the shared app project brings in its other client.
  await expect(canvasNode(page, MOCHIMA)).toHaveCount(0);
  await canvasNode(page, KAIROS_APP).dblclick();
  await expect(canvasNode(page, MOCHIMA)).toBeVisible();

  // "−" collapses: the nodes brought by the expansion leave, the project stays.
  await nodeList(page)
    .getByRole("button", { name: /^(Contraer|Collapse) App de reservas Kairos$/ })
    .click();
  await expect(canvasNode(page, MOCHIMA)).toHaveCount(0);
  await expect(canvasNode(page, KAIROS_APP)).toBeVisible();
});

test('HU-24 CA3: hovering a node shows the preview card, and "Abrir detalle" navigates to the record', async ({
  page,
}) => {
  await openGraph(page, "/clients/cli_kairos/graph", KAIROS);
  await canvasNode(page, KAIROS_WEB).hover();
  const card = page.getByRole("dialog", { name: "Sitio web Kairos Studio" });
  await expect(card).toBeVisible();
  await expect(card.getByText(/PRY-0001/)).toBeVisible();
  await card.getByRole("link", { name: /^(Abrir detalle|Open detail)$/ }).click();
  await expect(page).toHaveURL(/\/projects\/pry_kairos_web$/);
});

test("HU-24 CA4: the type filters hide and show nodes without reloading the page", async ({
  page,
}) => {
  await openGraph(page, "/clients/cli_kairos/graph", KAIROS);
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__e2eSamePage = true;
  });

  const filters = await openGraphFilters(page);
  const projects = filters.getByRole("checkbox", { name: /^(Proyectos|Projects) \(\d+\)$/ });
  await expect(projects).toBeChecked();
  await projects.click();
  await expect(canvasNode(page, KAIROS_WEB)).toHaveCount(0);
  await expect(
    nodeList(page).getByRole("button", { name: /^(Seleccionar|Select) Sitio web Kairos Studio$/ }),
  ).toHaveCount(0);
  await expect(canvasNode(page, KAIROS)).toBeVisible();

  await projects.click();
  await expect(canvasNode(page, KAIROS_WEB)).toBeVisible();
  // Same document: no navigation happened and the window state survived.
  expect(navigations).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__e2eSamePage),
  ).toBe(true);
});

test('HU-24 CA5: with more than 50 neighbours the "+N más" node appears', async ({ page }) => {
  test.setTimeout(240_000);
  // Gráficas Caribe starts without projects or invoices: 51 contacts push it over the 50-neighbour page.
  await open(page, `/clients/${CARIBE_ID}?tab=contacts`);
  for (let i = 0; i < 51; i += 1) {
    const name = `Contacto E2E ${String(i).padStart(2, "0")}`;
    await page.getByRole("button", { name: "Nuevo contacto", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo contacto", exact: true });
    await dialog.getByLabel("Nombre completo", { exact: true }).fill(name);
    await dialog.getByLabel("Email", { exact: true }).fill(`contacto.e2e.${i}@example.com`);
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await openGraph(page, `/clients/${CARIBE_ID}/graph`, `CLIENT:${CARIBE_ID}`);
  const more = page
    .locator("button[aria-label]")
    .filter({ hasText: /^\+\d+ (más|more)$/ })
    .first();
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute(
    "aria-label",
    /^(Cargar \d+ vecinos más de Gráficas Caribe|Load \d+ more neighbou?rs of Gráficas Caribe)$/,
  );
  const shown = await page.locator('[data-testid^="graph-node-CONTACT:"]').count();
  await more.click();
  await expect
    .poll(async () => page.locator('[data-testid^="graph-node-CONTACT:"]').count())
    .toBeGreaterThan(shown);
});

test("graph keyboard alternative: the node list selects a node with Enter and opens its side panel", async ({
  page,
}) => {
  await openGraph(page, "/clients/cli_kairos/graph", KAIROS);
  const item = nodeList(page).getByRole("button", {
    name: /^(Seleccionar|Select) Sitio web Kairos Studio$/,
  });
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(item).toHaveAttribute("aria-pressed", "true");

  const panel = sidePanel(page);
  await expect(panel.getByRole("heading", { name: "Sitio web Kairos Studio" })).toBeVisible();
  await expect(panel.getByRole("link", { name: /^(Abrir detalle|Open detail)$/ })).toHaveAttribute(
    "href",
    "/projects/pry_kairos_web",
  );
  await expect(
    panel.getByRole("link", { name: /^(Ver su grafo|View its graph)$/ }),
  ).toHaveAttribute("href", "/projects/pry_kairos_web/graph");
  // Expanding from the panel by keyboard adds the shared project's other nodes.
  const before = await page.locator('[data-testid^="graph-node-"]').count();
  await panel.getByRole("button", { name: /^(Expandir|Expand)$/ }).focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => page.locator('[data-testid^="graph-node-"]').count())
    .toBeGreaterThan(before);
});

// ───────────────────────────── HU-25 · global graph ─────────────────────────────

test("HU-25 CA1: /graph shows clients, projects and documents by default with the force layout", async ({
  page,
}) => {
  await openGraph(page, "/graph", KAIROS);
  for (const type of ["CLIENT", "PROJECT", "DOCUMENT"]) {
    await expect(page.locator(`[data-testid^="graph-node-${type}:"]`).first()).toBeVisible();
  }
  for (const type of ["CONTACT", "INVOICE", "PAYMENT", "EXPENSE", "NOTE"]) {
    await expect(page.locator(`[data-testid^="graph-node-${type}:"]`), type).toHaveCount(0);
  }
  await expect(page.getByRole("radio", { name: /^(Fuerzas|Force)$/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const filters = await openGraphFilters(page);
  for (const label of ["(Clientes|Clients)", "(Proyectos|Projects)", "(Documentos|Documents)"]) {
    await expect(
      filters.getByRole("checkbox", { name: new RegExp(`^${label} \\(\\d+\\)$`) }),
    ).toBeChecked();
  }
});

test("HU-25 CA2: searching a name centers and highlights that node", async ({ page }) => {
  await openGraph(page, "/graph", KAIROS);
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");

  await page.getByLabel(/^(Buscar en el grafo|Search the graph)$/).fill("kairos studio");
  await page
    .getByRole("toolbar", { name: /^(Herramientas del grafo|Graph tools)$/ })
    .getByRole("button", { name: /^(Buscar|Search)$/ })
    .click();
  await expect(page.getByText(/^(Centrado en|Centered on) Kairos Studio\.$/)).toBeVisible();
  await expect(canvasNode(page, KAIROS)).toHaveAttribute("data-highlighted", "true");
  await expect.poll(async () => viewport.getAttribute("style")).not.toBe(before);
  await expect(
    sidePanel(page).getByRole("link", { name: /^(Ver desde aquí|View from here)$/ }),
  ).toHaveAttribute("href", "/clients/cli_kairos/graph");
});

// ───────────────────────────── HU-26 · Cmd+K ─────────────────────────────

test('HU-26 CA1: searching "garcia" finds "García" (ignores accents)', async ({ page }) => {
  await createClient(page, "Talleres García", "E2E-HU26-1");
  await open(page, "/dashboard");
  const dialog = await searchCmdK(page, "garcia");
  await expect(dialog.getByRole("option", { name: /Talleres García/ })).toBeVisible();
});

test('HU-26 CA2: searching "invsion" finds "Inversión" (trigram similarity)', async ({ page }) => {
  await createClient(page, "Grupo Inversión", "E2E-HU26-2");
  await open(page, "/dashboard");
  const dialog = await searchCmdK(page, "invsion");
  await expect(dialog.getByRole("option", { name: /Grupo Inversión/ })).toBeVisible();
});

test("HU-26 CA3: searching an invoice code goes straight to that invoice", async ({ page }) => {
  // The seed holds FAC-0001..FAC-0004; the PRD example FAC-0012 does not exist over mocks.
  await open(page, "/dashboard");
  const dialog = await searchCmdK(page, "FAC-0003");
  const option = dialog.getByRole("option", { name: /FAC-0003/ });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/invoices\/inv_kairos_overdue$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// ───────────────────────────── HU-28 · archive and trash ─────────────────────────────

test('HU-28 CA1: an archived client leaves the table, the search and the graph unless "Mostrar archivados"; it is restored from the trash', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, `/clients/${CARIBE_ID}`);
  await page.getByRole("button", { name: "Más acciones", exact: true }).click();
  await page.getByRole("menuitem", { name: "Archivar cliente", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Archivar", exact: true })
    .click();
  await expect(page.getByText("1 cliente archivado", { exact: true })).toBeVisible();

  // Table: hidden, then shown by "Mostrar archivados".
  await open(page, "/clients/list");
  const tableSearch = page.getByRole("searchbox", { name: "Buscar en la tabla", exact: true });
  await tableSearch.fill(CARIBE);
  await expect(page.getByRole("row").filter({ hasText: CARIBE })).toHaveCount(0);
  await page.getByRole("switch", { name: "Mostrar archivados", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: CARIBE })).toBeVisible();

  // Search: Cmd+K does not list it.
  await open(page, "/dashboard");
  const dialog = await searchCmdK(page, "Graficas Caribe");
  await expect(dialog.getByRole("option", { name: new RegExp(CARIBE) })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Graph: hidden from /graph, shown by "Mostrar archivados" in the filters.
  await openGraph(page, "/graph", KAIROS);
  await expect(canvasNode(page, `CLIENT:${CARIBE_ID}`)).toHaveCount(0);
  const filters = await openGraphFilters(page);
  await filters.getByRole("switch", { name: /^(Mostrar archivados|Show archived)$/ }).click();
  await expect(canvasNode(page, `CLIENT:${CARIBE_ID}`)).toBeVisible();

  // Restore from Configuración → Papelera: it comes back to the table and the search.
  await open(page, "/settings/trash");
  await page.getByRole("button", { name: `Restaurar ${CARIBE}`, exact: true }).click();
  await expect(page.getByText(`${CARIBE} restaurado`)).toBeVisible();
  await open(page, "/clients/list");
  await page.getByRole("searchbox", { name: "Buscar en la tabla", exact: true }).fill(CARIBE);
  await expect(page.getByRole("row").filter({ hasText: CARIBE })).toBeVisible();
  const again = await searchCmdK(page, "Graficas Caribe");
  await expect(again.getByRole("option", { name: new RegExp(CARIBE) })).toBeVisible();
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
  await open(page, "/reports");
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
  await open(page, "/reports/billed-vs-collected");
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
