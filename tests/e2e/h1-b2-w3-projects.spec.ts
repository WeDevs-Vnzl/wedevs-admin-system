import { expect, test, type Page } from "@playwright/test";

// Wave 3 E2E, projects (H1-B2, TASK.md "Tester scope"). This file starts nothing: it runs against the app that
// PLAYWRIGHT_BASE_URL points to (safeguards.md rule 1). The mock store is one in-memory object per server process and
// every browser context shares it, so the tests that mutate it run one at a time (`--workers=1`, no serial mode, so
// one failure does not skip the rest) and reset it through the user menu ("Restablecer datos de prueba") before each
// test. View-as-role lives in the cookie of each context. Seed facts used below (src/mocks/fixtures/projects.ts):
// `pry_kairos_web` is EN_CURSO and has two REPOSITORIO links; `pry_orinoco_tracking` is PROPUESTA with no billing (no
// INTEGRITY_LOCK on archive); `pry_solaris_portal` is EN_CURSO; `cli_kairos` (CLI-0001) and `cli_hotel_mochima`-style
// clients exist as client pickers' options. Billing plans, installments, recurring charges and invoices are empty in
// the seed (fixtures/billing.ts, fixtures/invoices.ts), so no project has active billing: the archive INTEGRITY_LOCK
// step is not reachable.

const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;

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

/** The link handles of the Enlaces tab, in DOM order (the aria-label names the link). */
function linkHandles(page: Page) {
  return page.getByRole("button", { name: /^Reordenar / });
}

// ───────────────────────────── HU-05 Create project ─────────────────────────────

test.describe("HU-05 create project (mutates projects)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("CA1: no save without a client", async ({ page }) => {
    await open(page, "/projects/new");
    await page.getByLabel("Nombre", { exact: true }).fill("Proyecto sin cliente E2E");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(page.getByText("Vincula al menos un cliente.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/new$/);
  });

  test("CA2: each linked client keeps its own role; CA3: the project is listed in each client's Proyectos tab", async ({
    page,
  }) => {
    const name = "Proyecto E2E dos clientes";
    await open(page, "/projects/new");
    await page.getByLabel("Nombre", { exact: true }).fill(name);
    await page
      .getByLabel("Resumen", { exact: true })
      .fill("Resumen del proyecto E2E de dos clientes");

    const clients = page.getByRole("combobox", { name: "Clientes", exact: true });
    await clients.fill("Kairos");
    await page.getByRole("option", { name: "Kairos Studio" }).click();
    await page
      .getByRole("textbox", { name: "Rol: Kairos Studio", exact: true })
      .fill("Contratante");

    await clients.fill("Hotel Playa");
    await page.getByRole("option", { name: "Hotel Playa Mochima" }).click();
    await page
      .getByRole("textbox", { name: "Rol: Hotel Playa Mochima", exact: true })
      .fill("Usuario final");

    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText(/Proyecto PRY-\d{4} creado/)).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/pry_/);

    // CA3: listed in each linked client's Proyectos tab.
    for (const clientId of ["cli_kairos", "cli_hotel_mochima"]) {
      await open(page, `/clients/${clientId}?tab=projects`);
      // The name sits inside the project cell next to its code, so match it by substring (not exact text).
      await expect(page.getByText(name)).toBeVisible();
    }
  });
});

// ───────────────────────────── HU-06 Technologies ─────────────────────────────

test.describe("HU-06 technologies (read only)", () => {
  test("CA1: the stack picker groups the active technologies by their translated category", async ({
    page,
  }) => {
    await open(page, "/projects/new");

    await page.locator("#project-stack").click();
    const list = page.getByRole("listbox");
    await expect(list.getByRole("group").first()).toBeVisible();
    // Group headings are the translated categories (TechCategory in enums.json), never the raw enum values.
    await expect(list.getByText("Frontend", { exact: true })).toBeVisible();
    await expect(list.getByText("FRONTEND", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("CA2: the Tecnología filter on /projects/list narrows the table to the projects that use Next.js", async ({
    page,
  }) => {
    await open(page, "/projects/list");
    await page.getByRole("button", { name: "+ Tecnología", exact: true }).click();
    await page.getByText("Next.js", { exact: true }).click();

    const rows = page.getByRole("row").filter({ has: page.getByRole("cell") });
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasText: "Kairos Studio" }).first()).toBeVisible();
  });
});

// ───────────────────────────── HU-07 Links ─────────────────────────────

test.describe("HU-07 project links (mutates link order)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("CA1: several REPOSITORIO links are listed in their group", async ({ page }) => {
    await open(page, "/projects/pry_kairos_web?tab=links");
    // The group heading is the trigger of a collapsible: its name is "Repositorio" plus the count, so match the button.
    await expect(page.getByRole("button", { name: /^Repositorio/ }).first()).toBeVisible();
    expect(await linkHandles(page).count()).toBeGreaterThanOrEqual(2);
  });

  test("CA2: reorder by keyboard (dnd-kit) and by drag, and keep the order after reload", async ({
    page,
  }) => {
    await open(page, "/projects/pry_kairos_web?tab=links");
    const before = await linkHandles(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? ""),
    );
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Keyboard: Space picks the handle, ArrowDown moves it one place, Space drops it.
    const first = linkHandles(page).first();
    await first.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(300); // dnd-kit's keyboard sensor picks up the item on the next tick
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    await page.keyboard.press("Space");
    await expect(page.getByText("Orden de los enlaces guardado", { exact: true })).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");
    const afterKeyboard = await linkHandles(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? ""),
    );
    expect(afterKeyboard).toEqual([before[1], before[0], ...before.slice(2)]);

    // Drag with the pointer: move the first handle below the second one, then reload and check again.
    const handles = linkHandles(page);
    const source = await handles.nth(0).boundingBox();
    const target = await handles.nth(1).boundingBox();
    if (!source || !target) throw new Error("the link handles are not laid out");
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2, target.y + target.height + 4, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText("Orden de los enlaces guardado", { exact: true })).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");
    const afterDrag = await linkHandles(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? ""),
    );
    expect(afterDrag).not.toEqual(afterKeyboard);
  });

  test("CA3: a link with an invalid URL shows the error on the URL field", async ({ page }) => {
    await open(page, "/projects/pry_kairos_web/edit");
    await page.getByRole("button", { name: "Añadir enlace a Repositorio", exact: true }).click();
    const urls = page.getByLabel("URL", { exact: true });
    const blank = await urls.evaluateAll((nodes) =>
      nodes.findIndex((node) => node instanceof HTMLInputElement && node.value === ""),
    );
    expect(blank).toBeGreaterThanOrEqual(0);
    await page.getByLabel("Etiqueta", { exact: true }).nth(blank).fill("Enlace E2E");
    await urls.nth(blank).fill("esto no es una URL");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(urls.nth(blank)).toHaveAttribute("aria-invalid", "true");
  });
});

// ───────────────────────────── HU-08 Status transitions ─────────────────────────────

test.describe("HU-08 project status (mutates project status)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  async function chooseTarget(page: Page, label: string) {
    await page.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cambiar estado", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.locator("#transition-target").click();
    await page.getByRole("option", { name: label, exact: true }).click();
    return dialog;
  }

  test("CA1: EN_CURSO needs a start date", async ({ page }) => {
    await open(page, "/projects/pry_orinoco_tracking");
    const dialog = await chooseTarget(page, "En curso");
    await dialog.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    await expect(
      page.getByText("Pasar a En curso exige la fecha de inicio.", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("CA2: ENTREGADO needs the delivery date", async ({ page }) => {
    await open(page, "/projects/pry_solaris_portal");
    const dialog = await chooseTarget(page, "Entregado");
    await dialog.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    await expect(
      page.getByText("Pasar a Entregado exige la fecha real de entrega.", { exact: true }),
    ).toBeVisible();
  });

  test("CA3: CANCELADO opens the cancel confirmation with its two options", async ({ page }) => {
    await open(page, "/projects/pry_solaris_portal");
    const dialog = await chooseTarget(page, "Cancelado");
    // Submitting CANCELADO leaves the transition dialog for the cancel confirmation (ProjectCancelDialog).
    await dialog.getByRole("button", { name: "Cambiar estado", exact: true }).click();

    const cancel = page.getByRole("alertdialog");
    await expect(cancel.getByText("¿Cancelar registro?", { exact: true })).toBeVisible();
    await expect(cancel.getByText("Cancelar las cuotas pendientes", { exact: true })).toBeVisible();
    await expect(
      cancel.getByText("Finalizar los cobros recurrentes", { exact: true }),
    ).toBeVisible();
  });

  test("CA4: a status change shows as STATUS_CHANGE in the Actividad tab", async ({ page }) => {
    await open(page, "/projects/pry_kairos_web?tab=activity");
    await expect(page.getByText(/^Cambió el estado de /).first()).toBeVisible();
  });
});

// ───────────────────────────── Archive a project ─────────────────────────────

test.describe("archive a project (mutates projects)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("a project without active billing archives after one confirmation", async ({ page }) => {
    await open(page, "/projects/pry_orinoco_tracking");
    await page.getByRole("button", { name: "Más acciones", exact: true }).click();
    await page.getByRole("menuitem", { name: "Archivar proyecto", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("¿Archivar registro?", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Archivar", exact: true }).click();

    await expect(page.getByText("Proyecto archivado", { exact: true })).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Registro archivado", { exact: true })).toBeVisible();
  });

  // Not reachable with the seed: no project has billing plans, installments, recurring charges or invoices
  // (fixtures/billing.ts and fixtures/invoices.ts are empty), so the service never answers INTEGRITY_LOCK.
  // The lock step is covered at unit level; it needs H1-B3 billing data or a seed change to run here.
  test.skip("a project with active billing asks for the INTEGRITY_LOCK confirmation first", async () => {});
});

// ───────────────────────────── Read-only shape checks ─────────────────────────────

test.describe("projects (read only)", () => {
  test("an unknown project id renders the in-shell 404 page", async ({ page }) => {
    await page.goto("/projects/pry_no_existe");
    await expect(notFoundText(page)).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
  });

  test("an unknown project id answers HTTP 404", async ({ page }) => {
    const response = await page.goto("/projects/pry_no_existe");
    expect(response?.status()).toBe(404);
  });

  test("the project form renders in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto("/projects/new");
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    await expect(page.getByLabel("Nombre", { exact: true })).toBeVisible();
  });

  test("Miembro edits a project and does not see the Nuevo proyecto action", async ({ page }) => {
    await viewAsRole(page, "Miembro");
    await open(page, "/projects/pry_kairos_web");
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toBeVisible();

    await open(page, "/projects/list");
    await expect(page.getByRole("link", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);
  });

  test("Lector sees no write action on a project", async ({ page }) => {
    await viewAsRole(page, "Lector");
    await open(page, "/projects/pry_kairos_web");
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cambiar estado", exact: true })).toHaveCount(0);
  });
});
