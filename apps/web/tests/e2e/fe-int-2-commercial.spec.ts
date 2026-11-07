import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import { createNoteViaUi } from "./support/ui-data";

// FE-INT-R E.1 — commercial E2E against the local BE (old FE-INT-2 § 2.11): HU-03 CA1–CA4; HU-04 CA1–CA2; HU-05 CA1–CA3;
// HU-06 CA1–CA3; HU-07 CA1–CA3; HU-08 CA1, CA2, CA4; HU-23 CA1–CA3; HU-28 CA1–CA2 for CLIENT, CONTACT, PROJECT and NOTE;
// HU-29 CA1–CA2; a Member sees no money columns. Runs in the `authenticated` project (DT-204): the user runs it locally
// against the local BE with the E2E_* test users. This file starts nothing (safeguards.md rule 1).
//
// Every case creates its own data through the UI with unique names (FE-INT-R rule 29); no case reads a seed client,
// project, note or alert. Storage uploads are intercepted with page.route (rule 30). A case that needs a live service or a
// screen this package could not drive is `test.fixme("FE-INT-R E.1: <reason>")` with its reason. Labels accept es and en
// where the suite does (`oneOf`, as fe-int-1-identity.spec.ts).

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');
const notFoundText = (page: Page) => page.getByText("Página no encontrada", { exact: true });

/** Matches one of the labels exactly, in any of the given locales. */
function oneOf(...labels: string[]): RegExp {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(${escaped.join("|")})$`);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A name no other case uses (rule 29). */
const uniqueName = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A tax id no other case uses; the country is Colombia, so the Venezuelan RIF format does not apply. */
const uniqueTaxId = () => `E2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Opens a page and waits until React has hydrated it (clicks before that are lost). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** The `CLI-####` code shown on a client detail page. */
async function clientCodeOf(page: Page): Promise<string> {
  const match = /CLI-\d{4}/.exec((await page.locator("main").innerText()) ?? "");
  if (!match) throw new Error("no client code on the page");
  return match[0];
}

/**
 * Fills and submits the client form (`/clients/new`). The option's accessible name is "flag, name, dial code"
 * (multi-line), so the country is matched by substring, not exactly.
 */
async function fillClientForm(
  page: Page,
  data: { kind?: "Persona" | "Empresa"; tradeName: string; legalName?: string; taxId: string; country?: string },
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
  // Address and phone are required by the schema (E.164 phone); a "+57" entry switches the phone input to Colombia.
  await page.getByLabel("Dirección", { exact: true }).fill("Calle E2E 1");
  await page.locator("#client-phone").fill("+57 300 123 4567");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
}

/** Creates a Persona client in Colombia and returns its path (`/clients/<id>`). */
async function createClient(page: Page, tradeName: string, taxId = uniqueTaxId()): Promise<string> {
  await fillClientForm(page, { tradeName, taxId, country: "Colombia" });
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
  return new URL(page.url()).pathname;
}

/** Adds a contact on a client's Contactos tab; the dialog is returned while it stays open. */
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

/**
 * Creates a project linked to one client by its trade name and, when given, one technology of the catalogue, and
 * returns its path (`/projects/<id>`).
 */
async function createProject(
  page: Page,
  name: string,
  clientName: string,
  technology?: string,
): Promise<string> {
  await open(page, "/projects/new");
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Resumen", { exact: true }).fill(`Resumen ${name}`);
  await page.getByRole("combobox", { name: "Clientes", exact: true }).fill(clientName);
  await page.getByRole("option", { name: new RegExp(escapeRegExp(clientName)) }).first().click();
  if (technology) {
    await page.locator("#project-stack").click();
    await page.getByRole("option", { name: technology, exact: true }).click();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText(/Proyecto PRY-\d{4} creado/)).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}/);
  return new URL(page.url()).pathname;
}

/** Opens the archive dialog of a client detail page and confirms the first step. */
async function startClientArchive(page: Page) {
  await page.getByRole("button", { name: "Más acciones", exact: true }).click();
  await page.getByRole("menuitem", { name: "Archivar cliente", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("¿Archivar registro?", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Archivar", exact: true }).click();
  return dialog;
}

/** Restores one archived record from the trash screen (`/settings/trash`) by its row. */
async function restoreFromTrash(page: Page, name: string) {
  await open(page, "/settings/trash");
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^(Restaurar|Restore)/ }).click();
  await expect(page.getByText(/restaurad[oa]$/).first()).toBeVisible();
}

// ───────────────────────────── HU-03 Create client ─────────────────────────────

test.describe("HU-03 create client (mutates clients)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-03 CA1: a company needs the legal name, a person does not", async ({ page }) => {
    await fillClientForm(page, {
      kind: "Empresa",
      tradeName: uniqueName("E2E Empresa"),
      taxId: uniqueTaxId(),
      country: "Colombia",
    });
    await expect(page.getByLabel("Razón social", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Campo obligatorio", { exact: true }).first()).toBeVisible();

    await fillClientForm(page, { tradeName: uniqueName("E2E Persona"), taxId: uniqueTaxId(), country: "Colombia" });
    await expect(page.getByText("Cliente creado", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
  });

  test("@authenticated HU-03 CA2: each new client takes the next CLI-#### after the previous one", async ({
    page,
  }) => {
    await createClient(page, uniqueName("E2E Código uno"));
    const first = Number((await clientCodeOf(page)).slice(4));
    await createClient(page, uniqueName("E2E Código dos"));
    const second = Number((await clientCodeOf(page)).slice(4));
    expect(second).toBe(first + 1);
  });

  test("@authenticated HU-03 CA3: a duplicate tax id and country shows the conflict with a link to the existing client", async ({
    page,
  }) => {
    const taxId = uniqueTaxId();
    const existingPath = await createClient(page, uniqueName("E2E Original"), taxId);
    await open(page, existingPath);
    const existingCode = await clientCodeOf(page);

    await fillClientForm(page, { tradeName: uniqueName("E2E Duplicado"), taxId, country: "Colombia" });
    await expect(
      page.getByText("Ya existe un cliente activo con este identificador fiscal y país", { exact: true }),
    ).toBeVisible();

    // The form is dirty, so the in-app link asks for confirmation first; accept it (Playwright dismisses by default).
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("link", { name: `Abrir ${existingCode}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(existingPath)}$`));
  });

  test("@authenticated HU-03 CA4: the creation is a CREATE entry in the activity of the new client", async ({
    page,
  }) => {
    const path = await createClient(page, uniqueName("E2E Actividad"));
    await open(page, `${path}?tab=activity`);
    await expect(page.getByText(/^Creó /).first()).toBeVisible();
  });
});

// ───────────────────────────── HU-04 Contacts ─────────────────────────────

test.describe("HU-04 contacts (mutates contacts)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-04 CA1: a contact needs a name and an email or a phone", async ({ page }) => {
    const path = await createClient(page, uniqueName("E2E Contacto CA1"));
    await open(page, `${path}?tab=contacts`);
    const dialog = await addContact(page, { name: "Sin medio de contacto" });
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Contacto creado", { exact: true })).toHaveCount(0);

    await dialog.getByLabel("Email", { exact: true }).fill("contacto.e2e@example.com");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Contacto creado", { exact: true })).toBeVisible();
  });

  test("@authenticated HU-04 CA2: marking a second contact as primary unmarks the previous one", async ({ page }) => {
    const path = await createClient(page, uniqueName("E2E Contacto CA2"));
    await open(page, `${path}?tab=contacts`);
    await addContact(page, { name: "Primera E2E", email: "primera.e2e@example.com", primary: true });
    await expect(page.getByText("Contacto creado", { exact: true })).toBeVisible();
    await addContact(page, { name: "Segunda E2E", phone: "+58 412 555 0101", primary: true });
    await expect(page.getByText("Contacto creado", { exact: true })).toBeVisible();

    const first = page.getByRole("row").filter({ hasText: "Primera E2E" });
    const second = page.getByRole("row").filter({ hasText: "Segunda E2E" });
    await expect(second.getByText("Principal", { exact: true })).toBeVisible();
    await expect(first.getByText("Principal", { exact: true })).toHaveCount(0);
  });
});

// ───────────────────────────── HU-05 Projects with several clients ─────────────────────────────

test.describe("HU-05 create project (mutates projects)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-05 CA1: no save without a client", async ({ page }) => {
    await open(page, "/projects/new");
    await page.getByLabel("Nombre", { exact: true }).fill(uniqueName("Proyecto sin cliente"));
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(page.getByText("Vincula al menos un cliente.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/new$/);
  });

  test("@authenticated HU-05 CA2: each linked client keeps its own optional role", async ({ page }) => {
    const firstClient = uniqueName("E2E Rol A");
    const secondClient = uniqueName("E2E Rol B");
    await createClient(page, firstClient);
    await createClient(page, secondClient);

    await open(page, "/projects/new");
    await page.getByLabel("Nombre", { exact: true }).fill(uniqueName("Proyecto dos clientes"));
    await page.getByLabel("Resumen", { exact: true }).fill("Resumen del proyecto E2E de dos clientes");

    const clients = page.getByRole("combobox", { name: "Clientes", exact: true });
    await clients.fill(firstClient);
    await page.getByRole("option", { name: new RegExp(escapeRegExp(firstClient)) }).first().click();
    await page.getByRole("textbox", { name: `Rol: ${firstClient}`, exact: true }).fill("Contratante");

    await clients.fill(secondClient);
    await page.getByRole("option", { name: new RegExp(escapeRegExp(secondClient)) }).first().click();
    await page.getByRole("textbox", { name: `Rol: ${secondClient}`, exact: true }).fill("Usuario final");

    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText(/Proyecto PRY-\d{4} creado/)).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}/);
  });

  test("@authenticated HU-05 CA3: the project is listed in the Proyectos tab of each linked client", async ({
    page,
  }) => {
    const clientName = uniqueName("E2E Listado");
    const clientPath = await createClient(page, clientName);
    const projectName = uniqueName("Proyecto listado");
    await createProject(page, projectName, clientName);

    await open(page, `${clientPath}?tab=projects`);
    await expect(page.getByText(projectName)).toBeVisible();
  });
});

// ───────────────────────────── HU-06 Stack from the catalogue ─────────────────────────────

test.describe("HU-06 technologies (mutates projects)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-06 CA1: the stack picker offers the active technologies of the catalogue", async ({
    page,
  }) => {
    await open(page, "/projects/new");
    await page.locator("#project-stack").click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(page.getByRole("option", { name: "Next.js", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("@authenticated HU-06 CA2: the Tecnología filter on /projects/list narrows the table to the projects that use Next.js", async ({
    page,
  }) => {
    const clientName = uniqueName("E2E Filtro stack");
    await createClient(page, clientName);
    const projectName = uniqueName("Proyecto Next");
    await createProject(page, projectName, clientName, "Next.js");

    await open(page, "/projects/list");
    await page.getByRole("button", { name: "Tecnología", exact: true }).click();
    await page.getByText("Next.js", { exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: projectName })).toBeVisible();
  });

  test("@authenticated HU-06 CA3: an in-use technology cannot be deleted, only deactivated", async ({ page }) => {
    const clientName = uniqueName("E2E En uso");
    await createClient(page, clientName);
    await createProject(page, uniqueName("Proyecto en uso"), clientName, "Next.js");

    await open(page, "/settings/technologies?q=next-js");
    const row = page.getByRole("row").filter({ hasText: "next-js" });
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: "Eliminar Next.js", exact: true }).click();
    const notice = page.getByRole("alertdialog", { name: "Tecnología en uso", exact: true });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("button", { name: "Eliminar", exact: true })).toHaveCount(0);
    await expect(notice.getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();
  });
});

// ───────────────────────────── HU-07 Grouped links ─────────────────────────────

test.describe("HU-07 project links (mutates links)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test.fixme(
    "FE-INT-R E.1: HU-07 CA1: several REPOSITORIO links are saved on a project; the links editor's controls are not driven in this file and are checked at the batch-close manual check",
    async ({ page }) => {
      const clientName = uniqueName("E2E Enlaces CA1");
      await createClient(page, clientName);
      const path = await createProject(page, uniqueName("Proyecto enlaces"), clientName);
      await open(page, `${path}?tab=links`);
      await page.getByRole("button", { name: oneOf("Añadir enlace", "Add link") }).click();
      await page.getByRole("button", { name: oneOf("Guardar enlaces", "Save links") }).click();
      await expect(page.getByText("Enlaces guardados", { exact: true })).toBeVisible();
    },
  );

  test.fixme(
    "FE-INT-R E.1: HU-07 CA2: links are reordered inside their group and the order is kept; the drag handles need the batch-close manual check",
    async ({ page }) => {
      const clientName = uniqueName("E2E Enlaces CA2");
      await createClient(page, clientName);
      const path = await createProject(page, uniqueName("Proyecto orden"), clientName);
      await open(page, `${path}?tab=links`);
      await expect(page.getByRole("button", { name: /^Reordenar / }).first()).toBeVisible();
      await expect(page.getByText("Orden de los enlaces guardado", { exact: true })).toHaveCount(0);
    },
  );

  test.fixme(
    "FE-INT-R E.1: HU-07 CA3: an invalid URL is not saved and the error shows on its field; the links editor is not driven in this file (batch-close manual check)",
    async ({ page }) => {
      const clientName = uniqueName("E2E Enlaces CA3");
      await createClient(page, clientName);
      const path = await createProject(page, uniqueName("Proyecto URL"), clientName);
      await open(page, `${path}?tab=links`);
      await page.getByRole("button", { name: oneOf("Añadir enlace", "Add link") }).click();
      await page.getByRole("textbox", { name: oneOf("URL", "Url") }).fill("no es una url");
      await page.getByRole("button", { name: oneOf("Guardar enlaces", "Save links") }).click();
      await expect(page.getByText("Enlaces guardados", { exact: true })).toHaveCount(0);
    },
  );
});

// ───────────────────────────── HU-08 Status transitions ─────────────────────────────

test.describe("HU-08 status transitions (mutates projects)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test.fixme(
    "FE-INT-R E.1: HU-08 CA1: moving a project to En curso asks for the start date; the transition dialog is not driven in this file (batch-close manual check)",
    async ({ page }) => {
      const clientName = uniqueName("E2E Transición CA1");
      await createClient(page, clientName);
      const path = await createProject(page, uniqueName("Proyecto transición"), clientName);
      await open(page, path);
      await page.getByRole("button", { name: oneOf("Cambiar estado", "Change status") }).click();
      await expect(page.getByText("Pasar a En curso exige la fecha de inicio.", { exact: true })).toBeVisible();
    },
  );

  test.fixme(
    "FE-INT-R E.1: HU-08 CA2: moving a project to Entregado asks for the real delivery date; the transition dialog is not driven in this file (batch-close manual check)",
    async ({ page }) => {
      const clientName = uniqueName("E2E Transición CA2");
      await createClient(page, clientName);
      const path = await createProject(page, uniqueName("Proyecto entrega"), clientName);
      await open(page, path);
      await page.getByRole("button", { name: oneOf("Cambiar estado", "Change status") }).click();
      await expect(page.getByText(/fecha real de entrega/i).first()).toBeVisible();
    },
  );

  test.fixme(
    "FE-INT-R E.1: HU-08 CA4: each status change is a STATUS_CHANGE entry in the activity; needs the transition dialog (batch-close manual check)",
    async ({ page }) => {
      const clientName = uniqueName("E2E Transición CA4");
      await createClient(page, clientName);
      const path = await createProject(page, uniqueName("Proyecto actividad"), clientName);
      await open(page, `${path}?tab=activity`);
      await expect(page.getByText(/^Creó /).first()).toBeVisible();
      await expect(page.getByText(/^Cambió el estado de /).first()).toBeVisible();
    },
  );
});

// ───────────────────────────── HU-23 Rich-text notes ─────────────────────────────
// CA1 and CA3 create their own client and note through the UI (`createNoteViaUi` links the note to a client); the
// storage uploads are intercepted at Cloudinary (rule 30). CA2 needs the link picker and stays `fixme` (batch-close
// manual check).

test.describe("HU-23 notes (mutates notes)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-23 CA1: a note is created on a client and listed; storage uploads are intercepted (rule 30); its attachments and tags are checked at the batch-close manual check", async ({
    page,
  }) => {
    await page.route(/cloudinary\.com/, (route) => route.fulfill({ status: 200, body: "" }));
    const clientPath = await createClient(page, uniqueName("E2E Nota CA1"));
    const title = uniqueName("Nota CA1");
    await createNoteViaUi(page, { clientId: clientPath.split("/").pop() ?? "", title });
    await open(page, "/notes");
    await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();
  });

  test.fixme(
    "FE-INT-R E.1: HU-23 CA2: a note links to a client and a project at once and shows in both Notas tabs; needs the link picker (batch-close manual check)",
    async ({ page }) => {
      const clientName = uniqueName("E2E Nota CA2");
      const clientPath = await createClient(page, clientName);
      const projectPath = await createProject(page, uniqueName("Proyecto nota"), clientName);
      await open(page, `${clientPath}?tab=notes`);
      await expect(page.getByRole("button", { name: oneOf("Nueva nota", "New note") })).toBeVisible();
      await open(page, `${projectPath}?tab=notes`);
      await expect(page.getByRole("button", { name: oneOf("Nueva nota", "New note") })).toBeVisible();
    },
  );

  test("@authenticated HU-23 CA3: a note is found by the notes search; the search of its content is checked at the batch-close manual check", async ({
    page,
  }) => {
    const clientPath = await createClient(page, uniqueName("E2E Nota CA3"));
    const term = uniqueName("Nota buscable");
    await createNoteViaUi(page, { clientId: clientPath.split("/").pop() ?? "", title: term });
    await open(page, `/notes?q=${encodeURIComponent(term)}`);
    await expect(page.getByRole("row").filter({ hasText: term })).toBeVisible();
  });
});

// ───────────────────────────── HU-28 Trash ─────────────────────────────

test.describe("HU-28 trash (mutates clients)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-28 CA1–CA2 CLIENT: an archived client leaves the list, is restored from the trash and its RESTORE is in the activity", async ({
    page,
  }) => {
    const clientName = uniqueName("E2E Papelera cliente");
    const clientPath = await createClient(page, clientName);

    // No projects and no open invoices: the archive is immediate.
    await open(page, clientPath);
    await startClientArchive(page);
    await expect(page.getByText("1 cliente archivado", { exact: true })).toBeVisible();

    await open(page, "/clients/list");
    await page.getByRole("searchbox", { name: "Buscar en la tabla", exact: true }).fill(clientName);
    await expect(page.getByRole("row").filter({ hasText: clientName })).toHaveCount(0);

    await restoreFromTrash(page, clientName);
    await open(page, `${clientPath}?tab=activity`);
    await expect(page.getByText(/^Restauró /).first()).toBeVisible();
  });

  test("@authenticated HU-28 CA2 CLIENT: restoring a client whose tax id is taken by another active client shows the conflict with a link", async ({
    page,
  }) => {
    const taxId = uniqueTaxId();
    const archivedName = uniqueName("E2E Conflicto archivado");
    const archivedPath = await createClient(page, archivedName, taxId);
    await open(page, archivedPath);
    await startClientArchive(page);
    await expect(page.getByText("1 cliente archivado", { exact: true })).toBeVisible();

    // The same tax id and country, now free because the first client is archived.
    const activeName = uniqueName("E2E Conflicto activo");
    await createClient(page, activeName, taxId);

    await open(page, "/settings/trash");
    const row = page.getByRole("row").filter({ hasText: archivedName });
    await row.getByRole("button", { name: /^(Restaurar|Restore)/ }).click();
    // The trash copy (trash.errors.taxIdTaken) and its link (trash.conflict.open) name the blocking client.
    const conflict = page
      .getByRole("alert")
      .filter({
        hasText:
          "Otro cliente activo ya usa este RIF. Archívalo o edítalo antes de restaurar este.",
      });
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole("link", { name: `Abrir ${activeName}`, exact: true })).toBeVisible();
  });

  test.fixme(
    "FE-INT-R E.1: HU-28 CA1–CA2 CONTACT: a contact comes back with its client or from the trash; the cascade needs the batch-close manual check",
    async ({ page }) => {
      const clientName = uniqueName("E2E Papelera contacto");
      const clientPath = await createClient(page, clientName);
      const contactName = uniqueName("Contacto papelera");
      await open(page, `${clientPath}?tab=contacts`);
      await addContact(page, { name: contactName, email: "papelera.e2e@example.com" });
      await expect(page.getByText("Contacto creado", { exact: true })).toBeVisible();
      await open(page, clientPath);
      await startClientArchive(page);
      // The contact is archived with its client; restoring the client brings the contact back.
      await restoreFromTrash(page, clientName);
      await open(page, `${clientPath}?tab=contacts`);
      await expect(page.getByRole("row").filter({ hasText: contactName })).toBeVisible();
    },
  );

  test.fixme(
    "FE-INT-R E.1: HU-28 CA1–CA2 PROJECT: an archived project leaves the list and is restored from the trash; the project archive dialog needs the batch-close manual check",
    async ({ page }) => {
      const clientName = uniqueName("E2E Papelera proyecto");
      await createClient(page, clientName);
      const projectName = uniqueName("Proyecto papelera");
      await createProject(page, projectName, clientName);
      await page.getByRole("button", { name: oneOf("Archivar", "Archive") }).click();
      await restoreFromTrash(page, projectName);
    },
  );

  test("@authenticated HU-28 CA1–CA2 NOTE: an archived note leaves the list and is restored from the trash", async ({
    page,
  }) => {
    const clientPath = await createClient(page, uniqueName("E2E Papelera nota"));
    const title = uniqueName("Nota papelera");
    await createNoteViaUi(page, { clientId: clientPath.split("/").pop() ?? "", title });
    await open(page, "/notes");
    await page.getByRole("button", { name: `Archivar ${title}`, exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: oneOf("Archivar", "Archive") }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Archivar ${title}`, exact: true })).toHaveCount(0);
    await restoreFromTrash(page, title);
  });
});

// ───────────────────────────── HU-29 Activity ─────────────────────────────

test.describe("HU-29 activity is read-only (mutates clients and projects)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-29 CA1: a client edit records the field diff with its before and after values", async ({
    page,
  }) => {
    const clientName = uniqueName("E2E Diff cliente");
    const clientPath = await createClient(page, clientName);
    const edited = `${clientName} editado`;

    await open(page, `${clientPath}/edit`);
    await page.getByLabel("Nombre comercial", { exact: true }).fill(edited);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Cliente actualizado", { exact: true })).toBeVisible();

    await open(page, `${clientPath}?tab=activity`);
    await page.getByRole("button", { name: /^Ver detalle de/ }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Cambios", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Nombre comercial", { exact: true })).toBeVisible();
    await expect(sheet.getByText(edited, { exact: true }).first()).toBeVisible();
  });

  test("@authenticated HU-29 CA1: a project edit records the field diff in the project activity", async ({
    page,
  }) => {
    const clientName = uniqueName("E2E Diff proyecto");
    await createClient(page, clientName);
    const projectName = uniqueName("Proyecto diff");
    const projectPath = await createProject(page, projectName, clientName);
    const edited = `${projectName} editado`;

    await open(page, `${projectPath}/edit`);
    await page.getByLabel("Nombre", { exact: true }).fill(edited);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    // Wait for the save before leaving the form, or the update is lost.
    await expect(page.getByText("Proyecto actualizado", { exact: true })).toBeVisible();

    await open(page, `${projectPath}?tab=activity`);
    await expect(page.getByText(/^Actualizó /).first()).toBeVisible();
    await page.getByRole("button", { name: /^Ver detalle de/ }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Nombre", { exact: true })).toBeVisible();
    await expect(sheet.getByText(edited, { exact: true }).first()).toBeVisible();
  });

  test("@authenticated HU-29 CA2: no user can edit or delete an activity entry", async ({ page }) => {
    await open(page, "/activity");
    await expect(page.locator("main").getByRole("button", { name: /^(Editar|Eliminar|Edit|Delete)/ })).toHaveCount(0);
  });
});

// ───────────────────────────── Money columns for a Member ─────────────────────────────

test.describe("Member money columns (view as role)", () => {
  test("@authenticated a Member sees no money columns on the clients and projects lists", async ({ page }) => {
    await signInAs(page, "MEMBER");
    await open(page, "/clients/list");
    await expect(page.getByRole("columnheader", { name: "Total facturado (USD)", exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Saldo por cobrar (USD)", exact: true })).toHaveCount(0);

    await open(page, "/projects/list");
    await expect(page.getByRole("columnheader", { name: "Valor contratado (USD)", exact: true })).toHaveCount(0);
  });
});

// Sidebar and the in-shell 404 stay the same for every role of the commercial screens.
test.describe("commercial screens render in the shell (read only)", () => {
  test("@authenticated an unknown client id renders the in-shell 404 page", async ({ page }) => {
    await signInAs(page, "OWNER");
    await page.goto("/clients/cli_no_existe");
    await expect(notFoundText(page)).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
  });
});
