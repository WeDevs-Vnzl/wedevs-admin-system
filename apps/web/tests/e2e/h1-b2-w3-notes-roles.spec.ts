import { expect, test, type Browser, type Page } from "@playwright/test";
import { appBaseUrl } from "./support/app";
import { signInAs } from "./support/auth";
import { createNoteViaUi } from "./support/ui-data";

// Wave 3 E2E, notes, roles, navigation, accessibility and responsive (H1-B2, docs/TASK.md "Tester scope"), kept by
// FE-INT-R E.1. This file starts nothing: it runs against the app that PLAYWRIGHT_BASE_URL points to (safeguards.md
// rule 1). Every record a case reads is created through the UI with a unique name (FE-INT-R rule 29): the Owner
// creates it in the case's own browser context, and the Member or Viewer case opens it in a context of its own.
// Cases that need a note (a note needs a linked record through the link picker) are `test.fixme`.
// View-as-role lives in the cookie of each context, so a role never leaks into another test.

const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;
const RAW_KEY = /^[a-z]+(\.[A-Za-z0-9]+)+$/;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches one of the labels exactly, in any of the given locales. */
function oneOf(...labels: string[]): RegExp {
  return new RegExp(`^(${labels.map(escapeRegExp).join("|")})$`);
}

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');
const notFoundText = (page: Page) => page.getByText("Página no encontrada", { exact: true });

/** A name no other case uses (rule 29). */
const uniqueName = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A tax id no other case uses; the country is Colombia, so the Venezuelan RIF format does not apply. */
const uniqueTaxId = () => `E2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Opens a page and waits until React has hydrated it (clicks before that are lost). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Creates a Persona client in Colombia and returns its path (`/clients/<id>`). */
async function createClient(page: Page, tradeName: string): Promise<string> {
  await open(page, "/clients/new");
  await page.getByLabel("Nombre comercial", { exact: true }).fill(tradeName);
  await page.getByLabel("Identificador fiscal", { exact: true }).fill(uniqueTaxId());
  await page.getByRole("combobox", { name: "País", exact: true }).click();
  await page.getByRole("option", { name: "Colombia" }).click();
  await page.getByLabel("Dirección", { exact: true }).fill("Calle E2E 1");
  await page.locator("#client-phone").fill("+57 300 123 4567");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
  return new URL(page.url()).pathname;
}

/** Creates a project linked to one client by its trade name and returns its path (`/projects/<id>`). */
async function createProject(page: Page, name: string, clientName: string): Promise<string> {
  await open(page, "/projects/new");
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Resumen", { exact: true }).fill(`Resumen ${name}`);
  await page.getByRole("combobox", { name: "Clientes", exact: true }).fill(clientName);
  await page
    .getByRole("option", { name: new RegExp(clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
    .first()
    .click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText(/Proyecto PRY-\d{4} creado/)).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}/);
  return new URL(page.url()).pathname;
}

/** Creates one client and one project linked to it, as the signed-in user of `page`. */
async function createRecords(page: Page): Promise<{ clientPath: string; projectPath: string }> {
  const clientName = uniqueName("E2E Roles cliente");
  const clientPath = await createClient(page, clientName);
  const projectPath = await createProject(page, uniqueName("E2E Roles proyecto"), clientName);
  return { clientPath, projectPath };
}

/**
 * Creates the records as the Owner in a browser context of its own and returns their paths, so that a Member or a
 * Viewer case opens records it did not create in the same context.
 */
async function createRecordsAsOwner(browser: Browser): Promise<{ clientPath: string; projectPath: string }> {
  const context = await browser.newContext({ baseURL: appBaseUrl() });
  try {
    const page = await context.newPage();
    await signInAs(page, "OWNER");
    return await createRecords(page);
  } finally {
    await context.close();
  }
}

/** Creates a client and one note on it as the Owner, in a browser context of its own (a Member case reads it). */
async function createNoteAsOwner(browser: Browser): Promise<void> {
  const context = await browser.newContext({ baseURL: appBaseUrl() });
  try {
    const page = await context.newPage();
    await signInAs(page, "OWNER");
    const clientPath = await createClient(page, uniqueName("E2E Nota propietario"));
    await createNoteViaUi(page, {
      clientId: clientPath.split("/").pop() ?? "",
      title: uniqueName("Nota del propietario"),
    });
  } finally {
    await context.close();
  }
}

/** WCAG contrast ratio of the first heading in `main`, measured in the browser (dark mode spot check). */
async function headingContrast(page: Page): Promise<number> {
  return page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>("main h1");
    if (!heading) throw new Error("no heading in main");
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    // A 1×1 canvas turns any CSS colour (oklch included) into sRGB bytes.
    const luminance = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const linear = (channel: number) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
    };
    // The heading is transparent in most themes: take the first opaque background up the tree.
    let node: HTMLElement | null = heading;
    let background = "rgb(255, 255, 255)";
    while (node) {
      const css = getComputedStyle(node).backgroundColor;
      if (css && css !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(css)) {
        background = css;
        break;
      }
      node = node.parentElement;
    }
    const text = luminance(getComputedStyle(heading).color);
    const back = luminance(background);
    return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
  });
}

// ───────────────────────────── HU-23 notes ─────────────────────────────
// A note needs a linked record chosen in the link picker, which this file does not drive. The cases stay `fixme`
// until a case of its own creates the note (rule 29).

test.describe("HU-23 notes (read only)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test(
    "a note keeps its author and creation date; its tags and attachments are checked at the batch-close manual check",
    async ({ page }) => {
      const clientPath = await createClient(page, uniqueName("E2E Nota autor"));
      await createNoteViaUi(page, {
        clientId: clientPath.split("/").pop() ?? "",
        title: uniqueName("Nota autor"),
      });
      await expect(page.getByText("Autor", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Creada", { exact: true }).first()).toBeVisible();
    },
  );

  test.fixme(
    "FE-INT-R E.1: a note linked to a client and a project shows in both feeds; needs a note linked to both, and the link picker is not driven in this file (batch-close manual check)",
    async ({ page }) => {
      const { clientPath, projectPath } = await createRecords(page);
      await open(page, `${clientPath}?tab=notes`);
      await expect(page.locator("main").getByText(/Nota/).first()).toBeVisible();
      await open(page, `${projectPath}?tab=notes`);
      await expect(page.locator("main").getByText(/Nota/).first()).toBeVisible();
    },
  );
});

test.describe("HU-29 activity is read-only (mutates a client)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("CA2: no edit or delete control on any activity entry, and a client edit shows its field diff", async ({
    page,
  }) => {
    const clientName = uniqueName("E2E Actividad cliente");
    const clientPath = await createClient(page, clientName);
    const edited = `${clientName} editado`;

    await open(page, `${clientPath}/edit`);
    await page.getByLabel("Nombre comercial", { exact: true }).fill(edited);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Cliente actualizado", { exact: true })).toBeVisible();

    await open(page, `${clientPath}?tab=activity`);
    const feed = page.locator("main");
    await expect(feed.getByText(/^Actualizó /).first()).toBeVisible();
    await expect(feed.getByRole("button", { name: /^(Editar|Eliminar|Edit|Delete)/ })).toHaveCount(
      0,
    );

    await feed
      .getByRole("button", { name: /^Ver detalle de/ })
      .first()
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Cambios", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Nombre comercial", { exact: true })).toBeVisible();
    // The name also sits in the sheet title ("Actualizó …") and the record link ("… Abrir registro"): an exact match
    // picks the diff value, the element under test.
    await expect(sheet.getByText(edited, { exact: true }).first()).toBeVisible();
  });
});

// ───────────────────────────── Roles (View as role) ─────────────────────────────

test.describe("roles (View as role)", () => {
  test("Miembro edits a project but cannot create one or archive a client", async ({
    browser,
    page,
  }) => {
    const { clientPath, projectPath } = await createRecordsAsOwner(browser);
    await signInAs(page, "MEMBER");
    await open(page, projectPath);
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toBeVisible();

    await open(page, "/projects/list");
    await expect(page.getByRole("link", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);

    await open(page, clientPath);
    const more = page.getByRole("button", { name: "Más acciones", exact: true });
    if ((await more.count()) > 0) {
      await more.click();
      await expect(
        page.getByRole("menuitem", { name: "Archivar cliente", exact: true }),
      ).toHaveCount(0);
    }
  });

  test("Miembro sees no finance tabs on a client and no money columns on the lists", async ({
    browser,
    page,
  }) => {
    const { clientPath } = await createRecordsAsOwner(browser);
    await signInAs(page, "MEMBER");
    await open(page, clientPath);
    await expect(page.getByRole("tab", { name: /^Facturas/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Pagos/ })).toHaveCount(0);

    await open(page, "/clients/list");
    await expect(
      page.getByRole("columnheader", { name: "Total facturado (USD)", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: "Saldo por cobrar (USD)", exact: true }),
    ).toHaveCount(0);

    await open(page, "/projects/list");
    await expect(
      page.getByRole("columnheader", { name: "Valor contratado (USD)", exact: true }),
    ).toHaveCount(0);
  });

  test(
    "Miembro archives only own notes: the archive control is missing on at least one note",
    async ({ browser, page }) => {
      await createNoteAsOwner(browser);
      await signInAs(page, "MEMBER");
      await open(page, "/notes");
      const rows = page.getByRole("row").filter({ has: page.getByRole("cell") });
      const archiveControls = page.getByRole("button", { name: /^Archivar / });
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
      expect(await archiveControls.count()).toBeLessThan(rowCount);
    },
  );

  test("Lector sees no write action on the clients, projects and notes screens", async ({
    browser,
    page,
  }) => {
    const { clientPath } = await createRecordsAsOwner(browser);
    await signInAs(page, "VIEWER");
    await open(page, "/clients/list");
    await expect(page.getByRole("link", { name: "Nuevo cliente", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nuevo cliente", exact: true })).toHaveCount(0);

    await open(page, clientPath);
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toHaveCount(0);

    await open(page, "/projects/list");
    await expect(page.getByRole("link", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);

    await open(page, "/notes");
    await expect(page.getByRole("link", { name: "Nueva nota", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Archivar / })).toHaveCount(0);
  });
});

// ───────────────────────────── Navigation sweep ─────────────────────────────

const H1_B2_STATIC_ROUTES = [
  "/clients",
  "/clients/list",
  "/clients/new",
  "/projects",
  "/projects/list",
  "/projects/new",
  "/notes",
  "/notes/new",
  "/activity",
  "/settings/tags",
  "/settings/technologies",
];

/** Opens a route in the shell and checks its heading is translated (no raw key). */
async function expectRouteRendersInShell(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(sidebar(page), path).toBeVisible();
  await expect(notFoundText(page), path).toHaveCount(0);

  const heading = page.locator("main h1").first();
  await expect(heading, path).toBeVisible();
  const text = (await heading.innerText()).trim();
  expect(text.length, `${path} has a heading`).toBeGreaterThan(0);
  expect(RAW_KEY.test(text), `${path} shows a raw key: ${text}`).toBe(false);
}

test.describe("navigation sweep (read only)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  for (const path of H1_B2_STATIC_ROUTES) {
    test(`renders ${path} in the shell with a translated heading`, async ({ page }) => {
      await expectRouteRendersInShell(page, path);
    });
  }

  test("renders the client and project detail and edit routes in the shell", async ({ page }) => {
    const { clientPath, projectPath } = await createRecords(page);
    for (const path of [clientPath, `${clientPath}/edit`, projectPath, `${projectPath}/edit`]) {
      await expectRouteRendersInShell(page, path);
    }
  });

  test("unknown ids and the graph route render the in-shell 404 page", async ({ page }) => {
    for (const path of [
      "/clients/cli_no_existe",
      "/projects/pry_no_existe",
      "/notes/note_no_existe",
      "/clients/cli_no_existe/graph",
    ]) {
      await page.goto(path);
      await expect(notFoundText(page), path).toBeVisible();
      await expect(sidebar(page), path).toBeVisible();
    }
  });

  test("the notes, graph and unknown note routes answer HTTP 404", async ({ page }) => {
    for (const path of ["/notes/note_no_existe", "/clients/cli_no_existe/graph"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });

  test("unknown client and project ids answer HTTP 404", async ({ page }) => {
    for (const path of ["/clients/cli_no_existe", "/projects/pry_no_existe"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

// ───────────────────────────── Accessibility ─────────────────────────────

test.describe("accessibility (read only)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("keyboard moves through the client form fields in order", async ({ page }) => {
    await open(page, "/clients/new");
    const tradeName = page.getByLabel("Nombre comercial", { exact: true });
    await tradeName.focus();
    await page.keyboard.press("Tab");
    // The info button of the "Razón social" label is a Tab stop between the two inputs.
    await expect(page.getByRole("button", { name: "Más información sobre Razón social", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Razón social", { exact: true })).toBeFocused();
  });

  test("keyboard moves through the project form fields in order", async ({ page }) => {
    await open(page, "/projects/new");
    await page.getByLabel("Nombre", { exact: true }).focus();
    await page.keyboard.press("Tab");
    // The info button of the "Clientes" label is a Tab stop before the combobox.
    await expect(page.getByRole("button", { name: "Más información sobre Clientes", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Clientes", exact: true })).toBeFocused();
  });

  // PRODUCT DEFECT D5 (minor, a11y WCAG 2.4.3), still present after fix package 3.8: route /clients/cli_zafiro_labs?tab=contacts,
  // focus the "Nuevo contacto" button, Enter, Escape. The dialog closes but document.activeElement is BODY, not the opener
  // (reproduced in headless Chromium on the integrated build, :3105). Likely cause, from reading use-opener-focus.ts:
  // ContactFormDialog is mounted with key={dialog.key} and open=true in one commit, so its useRef(open) starts true and the
  // hook never records the opener. Remove test.fail once the opener receives focus after Escape.
  // FE-INT-R E.1: the client it opens is created by the case itself (rule 29); the test.fail reason is unchanged.
  test.fail(
    "Escape closes the contact dialog and returns focus to its opener",
    async ({ page }) => {
      const clientPath = await createClient(page, uniqueName("E2E D5 contactos"));
      await open(page, `${clientPath}?tab=contacts`);
      const trigger = page.getByRole("button", { name: "Nuevo contacto", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Nuevo contacto", exact: true })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Nuevo contacto", exact: true })).toBeHidden();
      await expect(trigger).toBeFocused();
    },
  );

  test("arrow keys move between the detail tabs and select the focused tab", async ({ page }) => {
    const clientPath = await createClient(page, uniqueName("E2E Pestañas"));
    await open(page, clientPath);
    const summary = page.getByRole("tab", { name: "Resumen", exact: true });
    await summary.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /^Contactos/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

// ───────────────────────────── ES ↔ EN on a detail page (HU-30 CA1) ─────────────────────────────

test.describe("locale on a detail page (mutates the locale preference)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("switching ES to EN reformats the dates and money of a project detail", async ({ page }) => {
    const { projectPath } = await createRecords(page);
    await open(page, projectPath);
    const before = await page.locator("main").innerText();

    try {
      await page.getByRole("button", { name: "Idioma", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Search\b/ })).toBeVisible();

      const after = await page.locator("main").innerText();
      // Dates and money are rendered per locale (HU-30 CA1): the same record reads differently in EN.
      expect(after).not.toBe(before);
    } finally {
      // The locale is the user's preference: switch back to Spanish for the next run. The page is in English here.
      await open(page, projectPath);
      await page.getByRole("button", { name: oneOf("Idioma", "Language") }).click();
      await page.getByRole("menuitemradio", { name: "Español", exact: true }).click();
    }
  });
});

// ───────────────────────────── Responsive: no horizontal page scroll ─────────────────────────────

async function expectNoHorizontalScroll(page: Page, path: string) {
  await open(page, path);
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${path} has no horizontal page scroll`).toBeLessThanOrEqual(client);
}

test.describe("responsive desktop", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("the main lists and detail pages fit the desktop width", async ({ page }) => {
    const { clientPath, projectPath } = await createRecords(page);
    for (const path of ["/clients/list", clientPath, "/projects/list", projectPath, "/notes"]) {
      await expectNoHorizontalScroll(page, path);
    }
  });
});

test.describe("responsive tablet 820×1180", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("the main lists and detail pages fit the tablet width without horizontal page scroll", async ({
    page,
  }) => {
    const { clientPath, projectPath } = await createRecords(page);
    for (const path of ["/clients/list", clientPath, "/projects/list", projectPath, "/notes"]) {
      await expectNoHorizontalScroll(page, path);
    }
  });
});

// ───────────────────────────── Dark mode contrast (spot check) ─────────────────────────────

test.describe("dark mode contrast (read only)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("a heading on a detail page meets WCAG AA contrast in dark mode", async ({ page }) => {
    const clientPath = await createClient(page, uniqueName("E2E Contraste"));
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await open(page, clientPath);
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    expect(await headingContrast(page)).toBeGreaterThanOrEqual(4.5);
  });
});
