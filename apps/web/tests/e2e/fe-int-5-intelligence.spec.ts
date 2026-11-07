import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { appBaseUrl } from "./support/app";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import {
  addInstallmentViaUi,
  createAccountViaUi,
  createClientViaUi,
  createContactViaUi,
  createDocumentViaUi,
  createExpenseViaUi,
  createInvoiceViaUi,
  createNoteViaUi,
  createProjectViaUi,
  createUsdPaymentViaUi,
  openPage,
} from "./support/ui-data";

// FE-INT-R E.3 intelligence E2E: HU-10 CA4 (installment alert), HU-19 CA2 (expiry alert), HU-24 CA1–CA5 (entity
// graph), HU-25 CA1–CA2 (global graph), HU-26 CA1–CA3 (Cmd+K), HU-27 CA2 (CSV of a filtered table), HU-28 CA1 (archive
// hides a record from the table, the search and the graph unless "Mostrar archivados"; restore from the trash) and
// HU-31 CA1–CA2 (reports). HU-25 CA3 (>= 50 fps with 500 nodes) is the H1-FX manual check and is not automated.
// Runs in the `authenticated` project against the local BE (safeguards.md rule 1); nothing here starts a server.
// Every record is created through the UI with a unique name (W5 rule 29): one graph fixture (two clients that share a
// project, a contact, an invoice, a payment, a document, a note and an expense) is created once per run, and the
// tests that archive or export create their own clients. Copy is Spanish (the Owner's default locale).
//
// The Owner's column layout is mutated by the export case; it restores it through "Restablecer columnas".

const RUN = Date.now();

interface Fixture {
  clientA: { id: string; name: string };
  clientB: { id: string; name: string };
  project: { id: string; name: string };
  installmentLabel: string;
  documentTitle: string;
}

let fixture: Fixture;

const nodeId = (type: string, id: string) => `${type}:${id}`;
const canvasNode = (page: Page, id: string) => page.getByTestId(`graph-node-${id}`);
const nodesOfType = (page: Page, type: string) => page.locator(`[data-testid^="graph-node-${type}:"]`);
const nodeList = (page: Page) => page.getByRole("list", { name: /^(Lista de nodos|Node list)$/ });
const sidePanel = (page: Page) => page.getByRole("region", { name: /^(Nodo seleccionado|Selected node)$/ });

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
    const clientA = { name: `E2E Grafo A ${RUN}`, id: "" };
    const clientB = { name: `E2E Grafo B ${RUN}`, id: "" };
    clientA.id = await createClientViaUi(page, clientA.name, `E2E-GRA-${RUN}`);
    clientB.id = await createClientViaUi(page, clientB.name, `E2E-GRB-${RUN}`);
    const project = {
      name: `E2E Proyecto Grafo ${RUN}`,
      id: "",
    };
    project.id = await createProjectViaUi(page, {
      name: project.name,
      clients: [
        { clientName: clientA.name, role: "Contratante" },
        { clientName: clientB.name, role: "Usuario final" },
      ],
    });
    await createContactViaUi(page, clientA.id, `Contacto Grafo ${RUN}`, `grafo.${RUN}@example.com`);
    await createInvoiceViaUi(page, {
      clientName: clientA.name,
      invoiceNumber: `E2E-GRAFO-${RUN}`,
      price: "100",
    });
    const account = `E2E Cuenta Grafo ${RUN}`;
    await createAccountViaUi(page, { name: account, currency: "USD" });
    await createUsdPaymentViaUi(page, {
      clientName: clientA.name,
      accountName: account,
      amount: "40",
      reference: `E2E-GRAFO-${RUN}`,
    });
    const documentTitle = `E2E Propuesta ${RUN}`;
    await createDocumentViaUi(page, {
      title: documentTitle,
      type: "Propuesta comercial",
      clientId: clientA.id,
      expiresToday: true,
    });
    await createNoteViaUi(page, { clientId: clientA.id, title: `E2E Nota ${RUN}` });
    await createExpenseViaUi(page, {
      description: `E2E Gasto ${RUN}`,
      amount: "20",
      projectName: project.name,
    });
    const installmentLabel = `E2E Cuota ${RUN}`;
    await addInstallmentViaUi(page, project.id, { label: installmentLabel, amount: "100" });
    return { clientA, clientB, project, installmentLabel, documentTitle };
  } finally {
    await context.close();
  }
}

test.describe("FE-INT-5 intelligence", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await assertBackendHealthy();
    fixture = await arrange(browser);
  });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  // ───────────────────────────── alerts (HU-10 CA4, HU-19 CA2) ─────────────────────────────

  test('@authenticated HU-10 CA4: the "Cuota por facturar" alert shows in the bell and in the dashboard', async ({
    page,
  }) => {
    await openPage(page, "/dashboard");
    await page.getByRole("button", { name: /^Alertas/ }).click();
    const bell = page.getByRole("dialog", { name: "Alertas" });
    const alert = bell.locator("[data-alert-key]").filter({ hasText: fixture.installmentLabel });
    await expect(alert.getByText("Cuota por facturar", { exact: true })).toBeVisible();
    await expect(alert.getByText(fixture.project.name)).toBeVisible();
    await page.keyboard.press("Escape");

    // Dashboard panel "Cuotas por facturar (próximos 30 días)" lists the installment by its label.
    await expect(page.locator("main").getByText("Cuotas por facturar (próximos 30 días)")).toBeVisible();
    await expect(page.locator("main").getByText(fixture.installmentLabel).first()).toBeVisible();
  });

  test("@authenticated HU-19 CA2: a document that expires within its alert window shows in the alerts", async ({
    page,
  }) => {
    await openPage(page, "/dashboard");
    await page.getByRole("button", { name: /^Alertas/ }).click();
    const bell = page.getByRole("dialog", { name: "Alertas" });
    const alert = bell.locator("[data-alert-key]").filter({ hasText: fixture.documentTitle });
    await expect(alert.getByText("Documento por vencer", { exact: true })).toBeVisible();
    await expect(alert.getByText(/Vence hoy/)).toBeVisible();
  });

  // ───────────────────────────── HU-24 · entity graph ─────────────────────────────

  test("@authenticated HU-24 CA1: the client graph loads the client as root with its contacts, projects, invoices, payments, documents and notes", async ({
    page,
  }) => {
    const root = nodeId("CLIENT", fixture.clientA.id);
    await openGraph(page, `/clients/${fixture.clientA.id}/graph`, root);
    for (const type of ["CONTACT", "PROJECT", "INVOICE", "PAYMENT", "DOCUMENT", "NOTE"]) {
      await expect(nodesOfType(page, type).first(), `${type} node on the canvas`).toBeVisible();
    }
    await expect(canvasNode(page, nodeId("PROJECT", fixture.project.id))).toBeVisible();
    // The root is the starting point: it has no "+" of its own.
    await expect(
      nodeList(page).getByRole("button", { name: `Expandir ${fixture.clientA.name}`, exact: true }),
    ).toHaveCount(0);
  });

  test("@authenticated HU-24 CA2: expanding a project adds its expenses and the other clients of the project", async ({
    page,
  }) => {
    const project = nodeId("PROJECT", fixture.project.id);
    const other = nodeId("CLIENT", fixture.clientB.id);
    await openGraph(page, `/clients/${fixture.clientA.id}/graph`, nodeId("CLIENT", fixture.clientA.id));
    const before = await page.locator('[data-testid^="graph-node-"]').count();
    await expect(canvasNode(page, other)).toHaveCount(0);

    await nodeList(page)
      .getByRole("button", { name: `Expandir ${fixture.project.name}`, exact: true })
      .click();
    await expect
      .poll(async () => page.locator('[data-testid^="graph-node-"]').count())
      .toBeGreaterThan(before);
    await expect(nodesOfType(page, "EXPENSE").first()).toBeVisible();
    // The project shared with the second client brings that client in.
    await expect(canvasNode(page, other)).toBeVisible();

    // "−" collapses: the nodes brought by the expansion leave, the project stays.
    await nodeList(page)
      .getByRole("button", { name: `Contraer ${fixture.project.name}`, exact: true })
      .click();
    await expect(canvasNode(page, other)).toHaveCount(0);
    await expect(canvasNode(page, project)).toBeVisible();

    // Double click on the canvas node expands too.
    await canvasNode(page, project).dblclick();
    await expect(canvasNode(page, other)).toBeVisible();
  });

  test('@authenticated HU-24 CA3: hovering a node shows the preview card, and "Abrir detalle" navigates to the record', async ({
    page,
  }) => {
    await openGraph(page, `/clients/${fixture.clientA.id}/graph`, nodeId("CLIENT", fixture.clientA.id));
    await canvasNode(page, nodeId("PROJECT", fixture.project.id)).hover();
    const card = page.getByRole("dialog", { name: fixture.project.name });
    await expect(card).toBeVisible();
    await expect(card.getByText(/PRY-\d+/)).toBeVisible();
    await card.getByRole("link", { name: /^(Abrir detalle|Open detail)$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${fixture.project.id}$`));
  });

  test("@authenticated HU-24 CA4: the type filters hide and show nodes without reloading the page", async ({
    page,
  }) => {
    const project = nodeId("PROJECT", fixture.project.id);
    await openGraph(page, `/clients/${fixture.clientA.id}/graph`, nodeId("CLIENT", fixture.clientA.id));
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
    await expect(canvasNode(page, project)).toHaveCount(0);
    await expect(
      nodeList(page).getByRole("button", { name: `Seleccionar ${fixture.project.name}`, exact: true }),
    ).toHaveCount(0);
    await expect(canvasNode(page, nodeId("CLIENT", fixture.clientA.id))).toBeVisible();

    await projects.click();
    await expect(canvasNode(page, project)).toBeVisible();
    // Same document: no navigation happened and the window state survived.
    expect(navigations).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__e2eSamePage),
    ).toBe(true);
  });

  test('@authenticated HU-24 CA5: with more than 50 neighbours the "+N más" node appears', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const name = `E2E Grafo contactos ${RUN}`;
    const id = await createClientViaUi(page, name, `E2E-GRC-${RUN}`);
    // 51 contacts push the client over the 50-neighbour page.
    await openPage(page, `/clients/${id}?tab=contacts`);
    for (let i = 0; i < 51; i += 1) {
      await page.getByRole("button", { name: "Nuevo contacto", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Nuevo contacto", exact: true });
      await dialog
        .getByLabel("Nombre completo", { exact: true })
        .fill(`Contacto E2E ${String(i).padStart(2, "0")}`);
      await dialog.getByLabel("Email", { exact: true }).fill(`contacto.e2e.${RUN}.${i}@example.com`);
      await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
      await expect(dialog).toBeHidden();
    }

    await openGraph(page, `/clients/${id}/graph`, nodeId("CLIENT", id));
    const more = page
      .locator("button[aria-label]")
      .filter({ hasText: /^\+\d+ (más|more)$/ })
      .first();
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute(
      "aria-label",
      new RegExp(`^(Cargar \\d+ vecinos más de ${name}|Load \\d+ more neighbou?rs of ${name})$`),
    );
    const shown = await nodesOfType(page, "CONTACT").count();
    await more.click();
    await expect.poll(async () => nodesOfType(page, "CONTACT").count()).toBeGreaterThan(shown);
  });

  test("@authenticated graph keyboard alternative: the node list selects a node with Enter and opens its side panel", async ({
    page,
  }) => {
    await openGraph(page, `/clients/${fixture.clientA.id}/graph`, nodeId("CLIENT", fixture.clientA.id));
    const item = nodeList(page).getByRole("button", {
      name: `Seleccionar ${fixture.project.name}`,
      exact: true,
    });
    await item.focus();
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("aria-pressed", "true");

    const panel = sidePanel(page);
    await expect(panel.getByRole("heading", { name: fixture.project.name })).toBeVisible();
    await expect(panel.getByRole("link", { name: /^(Abrir detalle|Open detail)$/ })).toHaveAttribute(
      "href",
      `/projects/${fixture.project.id}`,
    );
    await expect(panel.getByRole("link", { name: /^(Ver su grafo|View its graph)$/ })).toHaveAttribute(
      "href",
      `/projects/${fixture.project.id}/graph`,
    );
    // Expanding from the panel by keyboard adds the shared project's other nodes.
    const before = await page.locator('[data-testid^="graph-node-"]').count();
    await panel.getByRole("button", { name: /^(Expandir|Expand)$/ }).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => page.locator('[data-testid^="graph-node-"]').count())
      .toBeGreaterThan(before);
  });

  // ───────────────────────────── HU-25 · global graph ─────────────────────────────

  test("@authenticated HU-25 CA1: /graph shows clients, projects and documents by default with the force layout", async ({
    page,
  }) => {
    await openGraph(page, "/graph", nodeId("CLIENT", fixture.clientA.id));
    for (const type of ["CLIENT", "PROJECT", "DOCUMENT"]) {
      await expect(nodesOfType(page, type).first()).toBeVisible();
    }
    for (const type of ["CONTACT", "INVOICE", "PAYMENT", "EXPENSE", "NOTE"]) {
      await expect(nodesOfType(page, type), type).toHaveCount(0);
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

  test("@authenticated HU-25 CA2: searching a name centers and highlights that node", async ({
    page,
  }) => {
    const client = nodeId("CLIENT", fixture.clientA.id);
    await openGraph(page, "/graph", client);
    const viewport = page.locator(".react-flow__viewport");
    const before = await viewport.getAttribute("style");

    await page.getByLabel(/^(Buscar en el grafo|Search the graph)$/).fill(fixture.clientA.name);
    await page
      .getByRole("toolbar", { name: /^(Herramientas del grafo|Graph tools)$/ })
      .getByRole("button", { name: /^(Buscar|Search)$/ })
      .click();
    await expect(page.getByText(`Centrado en ${fixture.clientA.name}.`)).toBeVisible();
    await expect(canvasNode(page, client)).toHaveAttribute("data-highlighted", "true");
    await expect.poll(async () => viewport.getAttribute("style")).not.toBe(before);
    await expect(
      sidePanel(page).getByRole("link", { name: /^(Ver desde aquí|View from here)$/ }),
    ).toHaveAttribute("href", `/clients/${fixture.clientA.id}/graph`);
  });

  // ───────────────────────────── HU-26 · Cmd+K ─────────────────────────────

  test('@authenticated HU-26 CA1: searching "garcia" finds "García" (ignores accents)', async ({
    page,
  }) => {
    const name = `Talleres García ${RUN}`;
    await createClientViaUi(page, name, `E2E-HU26-1-${RUN}`);
    await openPage(page, "/dashboard");
    const dialog = await searchCmdK(page, "garcia");
    await expect(dialog.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  });

  test('@authenticated HU-26 CA2: searching "invsion" finds "Inversión" (trigram similarity)', async ({
    page,
  }) => {
    const name = `Grupo Inversión ${RUN}`;
    await createClientViaUi(page, name, `E2E-HU26-2-${RUN}`);
    await openPage(page, "/dashboard");
    const dialog = await searchCmdK(page, "invsion");
    await expect(dialog.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  });

  test("@authenticated HU-26 CA3: searching an invoice code goes straight to that invoice", async ({
    page,
  }) => {
    const invoice = await createInvoiceViaUi(page, {
      clientName: fixture.clientA.name,
      invoiceNumber: `E2E-HU26-3-${Date.now()}`,
      price: "10",
    });
    // The detail header shows the number; the internal code (FAC-nnnn) sits in its description.
    const code = /FAC-\d+/.exec(await page.locator("main").innerText())?.[0];
    expect(code, "invoice code on the detail").toBeTruthy();

    await openPage(page, "/dashboard");
    const dialog = await searchCmdK(page, code ?? "");
    const option = dialog.getByRole("option", { name: new RegExp(code ?? "") });
    await expect(option.first()).toBeVisible();
    await expect(option.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  // ───────────────────────────── HU-27 · CSV of a filtered table ─────────────────────────────

  test("@authenticated HU-27 CA2: the CSV holds every row of the filter and only the visible columns", async ({
    page,
  }) => {
    const base = `E2E Exportar ${RUN}`;
    await createClientViaUi(page, `${base} uno`, `E2E-EXP1-${RUN}`);
    await createClientViaUi(page, `${base} dos`, `E2E-EXP2-${RUN}`);

    await openPage(page, "/clients/list");
    try {
      await page.getByRole("button", { name: "Columnas", exact: true }).click();
      await page.getByRole("checkbox", { name: "País", exact: true }).click();
      await page.keyboard.press("Escape");

      await page.getByRole("searchbox", { name: "Buscar en la tabla", exact: true }).fill(`${base} uno`);
      await expect(page.getByRole("row").filter({ hasText: `${base} dos` })).toHaveCount(0);
      await expect(page.getByRole("row").filter({ hasText: `${base} uno` })).toBeVisible();

      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Exportar", exact: true }).click();
      const file = await download;
      const csv = readFileSync(await file.path(), "utf8");
      const [header = "", ...rows] = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
      expect(csv.startsWith("﻿"), "UTF-8 BOM so Excel opens it").toBe(true);
      expect(header).toContain("Nombre comercial");
      expect(header).not.toContain("País");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(`${base} uno`);
      await expect(page.getByText(/Se exportó 1 fila/)).toBeVisible();
    } finally {
      await page.getByRole("button", { name: "Columnas", exact: true }).click();
      await page.getByRole("button", { name: "Restablecer columnas", exact: true }).click();
    }
  });

  // ───────────────────────────── HU-28 · archive and trash ─────────────────────────────

  test('@authenticated HU-28 CA1: an archived client leaves the table, the search and the graph unless "Mostrar archivados"; it is restored from the trash', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const name = `E2E Archivable ${RUN}`;
    const id = await createClientViaUi(page, name, `E2E-ARC-${RUN}`);
    await page.getByRole("button", { name: "Más acciones", exact: true }).click();
    await page.getByRole("menuitem", { name: "Archivar cliente", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archivar", exact: true }).click();
    await expect(page.getByText("1 cliente archivado", { exact: true })).toBeVisible();

    // Table: hidden, then shown by "Mostrar archivados".
    await openPage(page, "/clients/list");
    await page.getByRole("searchbox", { name: "Buscar en la tabla", exact: true }).fill(name);
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
    await page.getByRole("switch", { name: "Mostrar archivados", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();

    // Search: Cmd+K does not list it.
    await openPage(page, "/dashboard");
    const hidden = await searchCmdK(page, name);
    await expect(hidden.getByRole("option", { name: new RegExp(name) })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Graph: hidden from /graph, shown by "Mostrar archivados" in the filters.
    await openGraph(page, "/graph", nodeId("CLIENT", fixture.clientA.id));
    await expect(canvasNode(page, nodeId("CLIENT", id))).toHaveCount(0);
    const filters = await openGraphFilters(page);
    await filters.getByRole("switch", { name: /^(Mostrar archivados|Show archived)$/ }).click();
    await expect(canvasNode(page, nodeId("CLIENT", id))).toBeVisible();

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

  // ───────────────────────────── HU-31 · reports ─────────────────────────────

  /** The sparkline periods (YYYY-MM) of every KPI card. */
  async function kpiSparklines(page: Page): Promise<string[][]> {
    const cards = page.getByRole("list", { name: "KPI", exact: true }).locator(":scope > li");
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

  test("@authenticated HU-31 CA1: every KPI card shows its value and the last 12 months", async ({
    page,
  }) => {
    // The formulas themselves are covered by the BE unit tests (PRD HU-31 CA1); the screen shows each card whole.
    await openPage(page, "/reports");
    const cards = page.getByRole("list", { name: "KPI", exact: true }).locator(":scope > li");
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(cards.nth(i)).not.toHaveText(/^\s*$/);
      await expect(
        cards.nth(i).getByRole("list", { name: /^(Últimos 12 meses|Last 12 months)$/ }),
      ).toBeVisible();
    }
  });

  test("@authenticated HU-31 CA2: changing the date range updates every KPI card and the report charts", async ({
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
