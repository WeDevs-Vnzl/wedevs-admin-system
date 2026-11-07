import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import {
  caracasToday,
  createClientViaUi,
  createProjectViaUi,
  openPage,
  pickDateViaUi,
} from "./support/ui-data";

// Wave 3 E2E, projects (H1-B2, docs/TASK.md "Tester scope"), FE-INT-R E.3. Runs against PLAYWRIGHT_BASE_URL with the
// local BE (safeguards.md rule 1); nothing here starts a server. Every test signs in as the Owner (DT-204) and creates
// its own clients and projects through the UI with unique names (W5 rule 29): no seeded id, no mock reset. View-as-role
// tests create the project as the Owner first, then sign in as the other role.

const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');
const notFoundText = (page: Page) => page.getByText("Página no encontrada", { exact: true });

/** The link handles of the Enlaces tab, in DOM order (the aria-label names the link). */
function linkHandles(page: Page) {
  return page.getByRole("button", { name: /^Reordenar / });
}

/** Adds one REPOSITORIO link per entry on the project edit page and saves it. */
async function addRepositoryLinks(page: Page, projectId: string, links: { label: string; url: string }[]) {
  await openPage(page, `/projects/${projectId}/edit`);
  for (const [index, link] of links.entries()) {
    await page.getByRole("button", { name: "Añadir enlace a Repositorio", exact: true }).click();
    await page.getByLabel("Etiqueta", { exact: true }).nth(index).fill(link.label);
    await page.getByLabel("URL", { exact: true }).nth(index).fill(link.url);
  }
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Enlaces guardados", { exact: true })).toBeVisible();
}

const runId = () => Date.now().toString(36);

// ───────────────────────────── HU-05 Create project ─────────────────────────────

test.describe("HU-05 create project", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("CA1: no save without a client", async ({ page }) => {
    await openPage(page, "/projects/new");
    await page.getByLabel("Nombre", { exact: true }).fill(`Proyecto sin cliente E2E ${runId()}`);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(page.getByText("Vincula al menos un cliente.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/new$/);
  });

  test("CA2: each linked client keeps its own role; CA3: the project is listed in each client's Proyectos tab", async ({
    page,
  }) => {
    const run = runId();
    const kairos = `E2E Kairos ${run}`;
    const playa = `E2E Playa ${run}`;
    const kairosId = await createClientViaUi(page, kairos, `E2E-${run}-A`);
    const playaId = await createClientViaUi(page, playa, `E2E-${run}-B`);

    const name = `Proyecto E2E dos clientes ${run}`;
    const projectId = await createProjectViaUi(page, {
      name,
      summary: "Resumen del proyecto E2E de dos clientes",
      clients: [
        { clientName: kairos, role: "Contratante" },
        { clientName: playa, role: "Usuario final" },
      ],
    });
    expect(projectId).toMatch(/^[a-z0-9]{20,}$/);

    // CA2: the roles were saved per client (the Clientes tab of the project shows each role).
    await openPage(page, `/projects/${projectId}`);
    await expect(page.getByText("Contratante", { exact: true })).toBeVisible();
    await expect(page.getByText("Usuario final", { exact: true })).toBeVisible();

    // CA3: listed in each linked client's Proyectos tab.
    for (const clientId of [kairosId, playaId]) {
      await openPage(page, `/clients/${clientId}?tab=projects`);
      // The name sits inside the project cell next to its code, so match it by substring (not exact text).
      await expect(page.getByText(name)).toBeVisible();
    }
  });
});

// ───────────────────────────── HU-06 Technologies ─────────────────────────────

test.describe("HU-06 technologies", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("CA1: the stack picker groups the active technologies by their translated category", async ({
    page,
  }) => {
    await openPage(page, "/projects/new");

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
    const run = runId();
    const client = `E2E Tecnología ${run}`;
    await createClientViaUi(page, client, `E2E-${run}-T`);
    const name = `Proyecto E2E Next ${run}`;
    await createProjectViaUi(page, {
      name,
      clients: [{ clientName: client, role: "Contratante" }],
      technology: "Next.js",
    });

    await openPage(page, "/projects/list");
    await page.getByRole("button", { name: "Tecnología", exact: true }).click();
    await page.getByText("Next.js", { exact: true }).click();

    const rows = page.getByRole("row").filter({ has: page.getByRole("cell") });
    await expect(rows.filter({ hasText: name }).first()).toBeVisible();
  });
});

// ───────────────────────────── HU-07 Links ─────────────────────────────

test.describe("HU-07 project links", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  /** A project with two repository links, created through the UI. */
  async function projectWithRepositories(page: Page): Promise<string> {
    const run = runId();
    const client = `E2E Enlaces ${run}`;
    await createClientViaUi(page, client, `E2E-${run}-L`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E enlaces ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });
    await addRepositoryLinks(page, projectId, [
      { label: "Repositorio principal", url: "https://example.com/repo-main" },
      { label: "Repositorio secundario", url: "https://example.com/repo-second" },
    ]);
    return projectId;
  }

  test("CA1: several REPOSITORIO links are listed in their group", async ({ page }) => {
    const projectId = await projectWithRepositories(page);
    await openPage(page, `/projects/${projectId}?tab=links`);
    // The group heading is the trigger of a collapsible: its name is "Repositorio" plus the count, so match the button.
    await expect(page.getByRole("button", { name: /^Repositorio/ }).first()).toBeVisible();
    expect(await linkHandles(page).count()).toBeGreaterThanOrEqual(2);
  });

  test("CA2: reorder by keyboard (dnd-kit) and by drag, and keep the order after reload", async ({
    page,
  }) => {
    const projectId = await projectWithRepositories(page);
    await openPage(page, `/projects/${projectId}?tab=links`);
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
    const run = runId();
    const client = `E2E URL ${run}`;
    await createClientViaUi(page, client, `E2E-${run}-U`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E URL ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });

    await openPage(page, `/projects/${projectId}/edit`);
    await page.getByRole("button", { name: "Añadir enlace a Repositorio", exact: true }).click();
    await page.getByLabel("Etiqueta", { exact: true }).first().fill("Enlace E2E");
    const urls = page.getByLabel("URL", { exact: true });
    await urls.first().fill("esto no es una URL");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(urls.first()).toHaveAttribute("aria-invalid", "true");
  });
});

// ───────────────────────────── HU-08 Status transitions ─────────────────────────────

test.describe("HU-08 project status", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  async function chooseTarget(page: Page, label: string) {
    await page.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cambiar estado", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.locator("#transition-target").click();
    await page.getByRole("option", { name: label, exact: true }).click();
    return dialog;
  }

  /** A new project (PROPUESTA) moved to EN_CURSO with a start date, so the next transition has a source. */
  async function inProgressProject(page: Page): Promise<string> {
    const run = runId();
    const client = `E2E Estado ${run}`;
    await createClientViaUi(page, client, `E2E-${run}-S`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E estado ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });
    await openPage(page, `/projects/${projectId}`);
    const dialog = await chooseTarget(page, "En curso");
    await pickDateViaUi(page, dialog.getByLabel("Fecha de inicio", { exact: true }), caracasToday());
    await dialog.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    await expect(dialog).toBeHidden();
    return projectId;
  }

  test("CA1: EN_CURSO needs a start date", async ({ page }) => {
    const run = runId();
    const client = `E2E Inicio ${run}`;
    await createClientViaUi(page, client, `E2E-${run}-I`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E inicio ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });
    await openPage(page, `/projects/${projectId}`);
    const dialog = await chooseTarget(page, "En curso");
    await dialog.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    await expect(
      page.getByText("Pasar a En curso exige la fecha de inicio.", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("CA2: ENTREGADO needs the delivery date", async ({ page }) => {
    const projectId = await inProgressProject(page);
    await openPage(page, `/projects/${projectId}`);
    const dialog = await chooseTarget(page, "Entregado");
    await dialog.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    await expect(
      page.getByText("Pasar a Entregado exige la fecha real de entrega.", { exact: true }),
    ).toBeVisible();
  });

  test("CA3: CANCELADO opens the cancel confirmation with its two options", async ({ page }) => {
    const projectId = await inProgressProject(page);
    await openPage(page, `/projects/${projectId}`);
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
    const projectId = await inProgressProject(page);
    await openPage(page, `/projects/${projectId}?tab=activity`);
    await expect(page.getByText(/^Cambió el estado de /).first()).toBeVisible();
  });
});

// ───────────────────────────── Archive a project ─────────────────────────────

test.describe("archive a project", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("a project without active billing archives after one confirmation", async ({ page }) => {
    const run = runId();
    const client = `E2E Archivo ${run}`;
    await createClientViaUi(page, client, `E2E-${run}-R`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E archivo ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });

    await openPage(page, `/projects/${projectId}`);
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

  // DT-220: the project gets an open installment through the UI, so the first archive request answers
  // INTEGRITY_LOCK and the dialog asks again before archiving. The dialog's "Fecha de facturación" is a calendar
  // popover (DateField), so the day is picked in it; the labels come from billing.json.
  test("a project with an open installment asks for the INTEGRITY_LOCK confirmation first (HU-08 CA3, DT-220)", async ({
    page,
  }) => {
    const run = runId();
    const client = `E2E Bloqueo ${run}`;
    await createClientViaUi(page, client, `E2E-${run}-K`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E bloqueo ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });
    await openPage(page, `/projects/${projectId}/billing`);
    await page.getByRole("button", { name: "Nueva cuota", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva cuota", exact: true });
    await dialog.getByLabel("Nombre", { exact: true }).fill("Cuota E2E");
    await dialog.getByLabel("Monto", { exact: true }).fill("100");
    await pickDateViaUi(
      page,
      dialog.getByLabel("Fecha de facturación", { exact: true }),
      caracasToday(),
    );
    await dialog.getByRole("button", { name: "Crear cuota", exact: true }).click();

    await openPage(page, `/projects/${projectId}`);
    await page.getByRole("button", { name: "Más acciones", exact: true }).click();
    await page.getByRole("menuitem", { name: "Archivar proyecto", exact: true }).click();
    const archive = page.getByRole("alertdialog");
    await archive.getByRole("button", { name: "Archivar", exact: true }).click();

    await expect(
      archive.getByText("El proyecto tiene cobros o facturas activos. Confirma para archivarlo.", {
        exact: true,
      }),
    ).toBeVisible();
    await archive.getByRole("button", { name: "Archivar", exact: true }).click();
    await expect(page.getByText("Proyecto archivado", { exact: true })).toBeVisible();
  });
});

// ───────────────────────────── Read-only shape checks ─────────────────────────────

test.describe("projects (read only)", () => {
  test("an unknown project id renders the in-shell 404 page", async ({ page }) => {
    await signInAs(page, "OWNER");
    await page.goto("/projects/pry_no_existe");
    await expect(notFoundText(page)).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
  });

  test("an unknown project id answers HTTP 404", async ({ page }) => {
    await signInAs(page, "OWNER");
    const response = await page.goto("/projects/pry_no_existe");
    expect(response?.status()).toBe(404);
  });

  test("the project form renders in dark mode", async ({ page }) => {
    await signInAs(page, "OWNER");
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto("/projects/new");
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    await expect(page.getByLabel("Nombre", { exact: true })).toBeVisible();
  });

  test("Miembro edits a project and does not see the Nuevo proyecto action", async ({ page }) => {
    const run = runId();
    const client = `E2E Miembro ${run}`;
    await signInAs(page, "OWNER");
    await createClientViaUi(page, client, `E2E-${run}-M`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E miembro ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });

    await signInAs(page, "MEMBER");
    await openPage(page, `/projects/${projectId}`);
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toBeVisible();

    await openPage(page, "/projects/list");
    await expect(page.getByRole("link", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);
  });

  test("Lector sees no write action on a project", async ({ page }) => {
    const run = runId();
    const client = `E2E Lector ${run}`;
    await signInAs(page, "OWNER");
    await createClientViaUi(page, client, `E2E-${run}-V`);
    const projectId = await createProjectViaUi(page, {
      name: `Proyecto E2E lector ${run}`,
      clients: [{ clientName: client, role: "Contratante" }],
    });

    await signInAs(page, "VIEWER");
    await openPage(page, `/projects/${projectId}`);
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cambiar estado", exact: true })).toHaveCount(0);
  });
});
