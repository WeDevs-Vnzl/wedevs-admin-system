import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Wave 3 E2E, clients (H1-B2, TASK.md "Tester scope"). This file starts nothing: it runs against the app that
// PLAYWRIGHT_BASE_URL points to (safeguards.md rule 1). The mock store is one in-memory object per server process and
// every browser context shares it, so the tests that mutate it run one at a time (`--workers=1`, no serial mode, so
// one failure does not skip the rest) and reset it through the user menu ("Restablecer datos de prueba") before each
// test. View-as-role lives in the cookie of each context. Seed facts used below (src/mocks/fixtures/clients.ts):
// `cli_kairos` (CLI-0001, ACTIVO, VE, tax id J-30123456-7) owns several active projects and contacts;
// `cli_zafiro_labs` is ACTIVO with no projects and no contacts; `cli_veredas_digital` is archived. Codes are
// `CLI-####` from the highest seeded code.

const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;
const KAIROS_TAX_ID = "J-30123456-7";

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');
const notFoundText = (page: Page) => page.getByText("Página no encontrada", { exact: true });

/** Restores the mock data through the user menu. Locale-agnostic on purpose. */
async function resetMockData(page: Page) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle"); // menus open only after hydration; clicks fired earlier are lost
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

/** Sets the MOCK role of this context through "Ver como rol" in the user menu (cookie only). */
async function viewAsRole(page: Page, role: "Lector" | "Miembro") {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle"); // menus open only after hydration; clicks fired earlier are lost
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Ver como rol" }).hover();
  await page.getByRole("menuitemradio", { name: role, exact: true }).click();
  await expect(page.getByText(`Ahora ves la aplicación como ${role}`)).toBeVisible();
}

/** Opens a page and waits until React has hydrated it (clicks before that are lost). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Fills and submits the client form (`/clients/new`). `country` is the country name as the picker shows it. The
 * option's accessible name is "flag, name, dial code" (multi-line), so it is matched by substring, not exactly.
 */
async function fillClientForm(
  page: Page,
  data: {
    kind?: "Persona" | "Empresa";
    tradeName: string;
    legalName?: string;
    taxId: string;
    country?: string;
  },
) {
  await open(page, "/clients/new");
  if (data.kind === "Empresa") {
    await page.getByRole("combobox", { name: "Tipo de cliente", exact: true }).click();
    await page.getByRole("option", { name: "Empresa", exact: true }).click();
  }
  await page.getByLabel("Nombre comercial", { exact: true }).fill(data.tradeName);
  if (data.legalName) await page.getByLabel("Razón social", { exact: true }).fill(data.legalName);
  await page.getByLabel("Identificador fiscal", { exact: true }).fill(data.taxId);
  if (data.country) {
    await page.getByRole("combobox", { name: "País", exact: true }).click();
    await page.getByRole("option", { name: data.country }).click();
  }
  // Address and phone are required by the schema (E.164 phone); the phone input defaults to VE, so a "+57" entry
  // switches it to the number's own country.
  await page.getByLabel("Dirección", { exact: true }).fill("Calle E2E 1");
  await page.locator("#client-phone").fill("+57 300 123 4567");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
}

/** A column header by its label; the accessible name also carries the sort and resize labels. */
const columnHeader = (label: string) => new RegExp(`\\b${label}\\b`);

/** The `CLI-####` code shown on a client detail page. */
async function clientCodeOf(page: Page): Promise<string> {
  const match = /CLI-\d{4}/.exec((await page.locator("main").innerText()) ?? "");
  if (!match) throw new Error("no client code on the page");
  return match[0];
}

// ───────────────────────────── HU-03 Create client ─────────────────────────────

test.describe("HU-03 create client (mutates clients)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("CA1: a company needs the legal name, a person does not", async ({ page }) => {
    await fillClientForm(page, {
      kind: "Empresa",
      tradeName: "E2E Empresa CA1",
      taxId: "E2E-CA1-1",
      country: "Colombia",
    });
    await expect(page).toHaveURL(/\/clients/);
    await expect(page.getByLabel("Razón social", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByText("Campo obligatorio", { exact: true }).first()).toBeVisible();

    await fillClientForm(page, {
      tradeName: "E2E Persona CA1",
      taxId: "E2E-CA1-2",
      country: "Colombia",
    });
    await expect(page.getByText("Cliente creado", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/cli_/);
  });

  test("CA2: a new client takes the next CLI-#### after the highest code", async ({ page }) => {
    await fillClientForm(page, {
      tradeName: "E2E Código uno",
      taxId: "E2E-CA2-1",
      country: "Colombia",
    });
    await expect(page).toHaveURL(/\/clients\/cli_/);
    const first = Number((await clientCodeOf(page)).slice(4));

    await fillClientForm(page, {
      tradeName: "E2E Código dos",
      taxId: "E2E-CA2-2",
      country: "Colombia",
    });
    await expect(page).toHaveURL(/\/clients\/cli_/);
    const second = Number((await clientCodeOf(page)).slice(4));

    // The seed holds CLI-0001..CLI-n; the first new code is above the seed, and each next code is the previous + 1.
    expect(first).toBeGreaterThan(1);
    expect(second).toBe(first + 1);
  });

  test("CA3: a duplicate tax id and country shows the conflict with a link to the existing client", async ({
    page,
  }) => {
    await fillClientForm(page, {
      tradeName: "Duplicado E2E",
      taxId: KAIROS_TAX_ID,
      country: "Venezuela",
    });

    await expect(
      page.getByText("Ya existe un cliente activo con este identificador fiscal y país", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Identificador fiscal", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    // The form is dirty, so the in-app link asks for confirmation first (use-unsaved-changes.ts). Playwright
    // dismisses dialogs by default and would cancel the navigation, so accept the confirm.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("link", { name: "Abrir CLI-0001", exact: true }).click();
    await expect(page).toHaveURL(/\/clients\/cli_kairos$/);
  });

  test("CA4: the creation shows as CREATE in the Actividad tab of the new client", async ({
    page,
  }) => {
    await fillClientForm(page, {
      tradeName: "E2E Actividad CA4",
      taxId: "E2E-CA4-1",
      country: "Colombia",
    });
    await expect(page).toHaveURL(/\/clients\/cli_/);
    const url = new URL(page.url());
    await open(page, `${url.pathname}?tab=activity`);

    await expect(page.getByText(/^Creó /).first()).toBeVisible();
  });
});

// ───────────────────────────── HU-04 Contacts ─────────────────────────────

test.describe("HU-04 contacts (mutates contacts)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  async function addContact(
    page: Page,
    data: { name: string; email?: string; phone?: string; primary?: boolean },
  ) {
    await page.getByRole("button", { name: "Nuevo contacto", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo contacto", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nombre completo", { exact: true }).fill(data.name);
    if (data.email) await dialog.getByLabel("Email", { exact: true }).fill(data.email);
    if (data.phone) await dialog.getByLabel("Teléfono", { exact: true }).fill(data.phone);
    if (data.primary) await dialog.getByLabel("Contacto principal", { exact: true }).click();
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    return dialog;
  }

  test("CA1: a contact needs a name and an email or a phone", async ({ page }) => {
    await open(page, "/clients/cli_zafiro_labs?tab=contacts");
    const dialog = await addContact(page, { name: "Sin medio de contacto" });
    // The dialog stays open: nothing is saved without an email or a phone.
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Contacto creado", { exact: true })).toHaveCount(0);

    await dialog.getByLabel("Email", { exact: true }).fill("contacto.e2e@example.com");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Contacto creado", { exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Sin medio de contacto" })).toBeVisible();
  });

  test("CA2: marking a second contact as primary unmarks the previous one", async ({ page }) => {
    await open(page, "/clients/cli_zafiro_labs?tab=contacts");
    await addContact(page, {
      name: "Primera E2E",
      email: "primera.e2e@example.com",
      primary: true,
    });
    await expect(page.getByText("Contacto creado", { exact: true })).toBeVisible();
    await addContact(page, { name: "Segunda E2E", phone: "+58 412 555 0101", primary: true });
    await expect(page.getByText("Contacto creado", { exact: true })).toBeVisible();

    const first = page.getByRole("row").filter({ hasText: "Primera E2E" });
    const second = page.getByRole("row").filter({ hasText: "Segunda E2E" });
    await expect(second.getByText("Principal", { exact: true })).toBeVisible();
    await expect(first.getByText("Principal", { exact: true })).toHaveCount(0);
    await expect(
      first.getByRole("button", { name: "Marcar como principal", exact: true }),
    ).toBeVisible();
  });
});

// ───────────────────────────── HU-05 Client projects ─────────────────────────────

test.describe("HU-05 client projects", () => {
  test("CA3: the seeded projects are listed in the Proyectos tab of a linked client", async ({
    page,
  }) => {
    await resetMockData(page);
    await open(page, "/clients/cli_kairos?tab=projects");
    await expect(page.getByRole("link", { name: /^Ver proyecto PRY-\d{4}/ }).first()).toBeVisible();
  });
});

// ───────────────────────────── Archive and restore (INTEGRITY_LOCK) ─────────────────────────────

test.describe("archive and restore a client (mutates clients)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("a client with active projects asks for confirmation, archives its contacts, and can be restored", async ({
    page,
  }) => {
    await open(page, "/clients/cli_kairos?tab=contacts");
    const contactsTab = page.getByRole("tab", { name: /^Contactos/ });
    const contactsBefore = Number((await contactsTab.innerText()).replace(/\D+/g, "")) || 0;
    expect(contactsBefore).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Más acciones", exact: true }).click();
    await page.getByRole("menuitem", { name: "Archivar cliente", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("¿Archivar registro?", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Archivar", exact: true }).click();

    // INTEGRITY_LOCK: the dialog stays open and asks for the confirmation step.
    await expect(
      dialog.getByText(
        "Este cliente tiene proyectos activos o facturas abiertas. Confirma para archivarlo junto con sus contactos",
        { exact: true },
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Archivar", exact: true }).click();
    await expect(page.getByText("1 cliente archivado", { exact: true })).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Registro archivado", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Contactos/ })).toContainText("0");

    await page.getByRole("button", { name: "Restaurar", exact: true }).click();
    await expect(page.getByText("Cliente restaurado", { exact: true })).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Registro archivado", { exact: true })).toHaveCount(0);
  });

  test("Mostrar archivados on the list reveals the archived client, and a client without projects archives at once", async ({
    page,
  }) => {
    await open(page, "/clients/list");
    await expect(
      page.getByRole("switch", { name: "Mostrar archivados", exact: true }),
    ).toBeVisible();
    // 64 clients in the seed: the archived one is not on the first page, so the table is searched for it.
    await page
      .getByRole("searchbox", { name: "Buscar en la tabla", exact: true })
      .fill("Veredas Digital");
    await expect(page.getByRole("row").filter({ hasText: "Veredas Digital" })).toHaveCount(0);

    await page.getByRole("switch", { name: "Mostrar archivados", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "Veredas Digital" })).toBeVisible();

    await open(page, "/clients/cli_zafiro_labs");
    await page.getByRole("button", { name: "Más acciones", exact: true }).click();
    await page.getByRole("menuitem", { name: "Archivar cliente", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Archivar", exact: true }).click();
    await expect(page.getByText("1 cliente archivado", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
  });
});

// ───────────────────────────── /clients/list columns and CSV ─────────────────────────────

test.describe("clients list: columns and CSV (mutates the table preference)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("a hidden column stays hidden after reload and the CSV holds only the visible columns", async ({
    page,
  }) => {
    await open(page, "/clients/list");
    await expect(page.getByRole("columnheader", { name: columnHeader("Tipo") })).toBeVisible();

    await page.getByRole("button", { name: "Columnas", exact: true }).click();
    await page.getByRole("checkbox", { name: "Tipo", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: columnHeader("Tipo") })).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("columnheader", { name: columnHeader("Tipo") })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: columnHeader("Código") })).toBeVisible();

    const pagination = await page
      .getByText(/\d+–\d+ de \d+/)
      .first()
      .innerText();
    const total = Number(/de (\d+)/.exec(pagination)?.[1] ?? "0");
    expect(total).toBeGreaterThan(25); // more rows than one page, so the CSV must hold all the filtered rows

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar", exact: true }).click(),
    ]);
    const csv = await readFile(await download.path(), "utf8");

    expect(csv.startsWith("﻿"), "the CSV starts with a UTF-8 BOM").toBe(true);
    const lines = csv
      .slice(1)
      .split("\r\n")
      .filter((line) => line.length > 0);
    const header = lines[0] ?? "";
    expect(header).toContain("Código");
    expect(header).not.toContain("Tipo");
    expect(lines.length - 1).toBe(total);
  });
});

// ───────────────────────────── Documentos tab ─────────────────────────────

test.describe("client Documentos tab (mutates document links)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("attach an existing document, then unlink it", async ({ page }) => {
    await open(page, "/clients/cli_zafiro_labs?tab=documents");
    await page.getByRole("button", { name: "Adjuntar documento", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Adjuntar documento", exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("tab", { name: "Vincular existente", exact: true }).click();

    await sheet.getByPlaceholder("Busca por código o título").fill("minuta");
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await sheet.getByRole("button", { name: "Vincular documento", exact: true }).click();
    await expect(page.getByText("Documento vinculado", { exact: true })).toBeVisible();

    // The row control is named "Desvincular: <document title>", so only the prefix is matched.
    const linkedRows = page.getByRole("button", { name: /^Desvincular:/ });
    await expect(linkedRows.first()).toBeVisible();
    const before = await linkedRows.count();

    await linkedRows.first().click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Desvincular", exact: true })
      .click();
    await expect(page.getByText("Documento desvinculado", { exact: true })).toBeVisible();
    await expect(linkedRows).toHaveCount(before - 1);
  });

  // A pointer click on the option must select it (the popup sits outside the modal sheet's pointer-events scope).
  test(
    "a search result of the Vincular existente tab takes a pointer click",
    async ({ page }) => {
      await open(page, "/clients/cli_zafiro_labs?tab=documents");
      await page.getByRole("button", { name: "Adjuntar documento", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Adjuntar documento", exact: true });
      await sheet.getByRole("tab", { name: "Vincular existente", exact: true }).click();
      await sheet.getByPlaceholder("Busca por código o título").fill("minuta");
      await page.getByRole("option").first().click({ timeout: 5000 });
    },
  );
});

// ───────────────────────────── Shape checks that need no mutation ─────────────────────────────

test.describe("clients (read only)", () => {
  test("an unknown client id renders the in-shell 404 page", async ({ page }) => {
    await page.goto("/clients/cli_no_existe");
    await expect(notFoundText(page)).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
  });

  test("an unknown client id answers HTTP 404", async ({ page }) => {
    const unknown = await page.goto("/clients/cli_no_existe");
    expect(unknown?.status()).toBe(404);
  });

  test("the graph route renders the in-shell 404 with HTTP 404", async ({ page }) => {
    const graph = await page.goto("/clients/cli_kairos/graph");
    expect(graph?.status()).toBe(404);
    await expect(notFoundText(page)).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
  });

  test("the client form is dark-mode safe: the shell renders with the dark class", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto("/clients/new");
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    await expect(page.getByLabel("Nombre comercial", { exact: true })).toBeVisible();
  });
});

// Role check kept here: Viewer and Member never see the archive menu of a client (HU-03 roles, C13).
test.describe("client archive is hidden for roles without the grant", () => {
  test("Miembro does not see Archivar cliente on a client", async ({ page }) => {
    await viewAsRole(page, "Miembro");
    await open(page, "/clients/cli_zafiro_labs");
    const more = page.getByRole("button", { name: "Más acciones", exact: true });
    if ((await more.count()) > 0) {
      await more.click();
      await expect(
        page.getByRole("menuitem", { name: "Archivar cliente", exact: true }),
      ).toHaveCount(0);
    }
  });
});
