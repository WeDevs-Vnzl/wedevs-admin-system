import { expect, test, type Page } from "@playwright/test";

// Wave 3 E2E, notes, roles, navigation, accessibility and responsive (H1-B2, docs/TASK.md "Tester scope"). This file
// starts nothing: it runs against the app that PLAYWRIGHT_BASE_URL points to (safeguards.md rule 1). The mock
// store is one in-memory object per server process and every browser context shares it, so the tests that
// mutate it run one at a time (`--workers=1`, no serial mode, so one failure does not skip the rest) and reset
// it through the user menu ("Restablecer datos de prueba") before each test.
// View-as-role lives in the cookie of each context, so a role never leaks into another test.
//
// Seed facts used below: `note_kairos_alcance` ("Alcance acordado con Kairos", author usr_andres_molina) is
// linked to `cli_kairos` and `pry_kairos_web` at once (HU-23 CA2); `cli_kairos` has active projects and contacts;
// `pry_kairos_web` has the dates and money the locale test reformats.

const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;
const NOTE_TITLE = "Alcance acordado con Kairos";
const RAW_KEY = /^[a-z]+(\.[A-Za-z0-9]+)+$/;

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

test.describe("HU-23 notes (read only)", () => {
  test("CA1: a note keeps its author, date, tags and attachments", async ({ page }) => {
    await resetMockData(page);
    await open(page, "/notes/note_kairos_alcance");
    await expect(page.getByRole("heading", { name: NOTE_TITLE, exact: true })).toBeVisible();
    await expect(page.getByText("Andrés Molina", { exact: false }).first()).toBeVisible();
    // The tag is shown by its label ("Prioritario", catalogs.ts), not by its lowercase id.
    await expect(page.getByText("Prioritario", { exact: true }).first()).toBeVisible();
  });

  // The Notas tab of a client and of a project render the feed again (3.7 fixed the RSC boundary, T1).
  test("CA2: a note linked to a client and a project shows in both feeds", async ({ page }) => {
    await resetMockData(page);
    await open(page, "/clients/cli_kairos?tab=notes");
    await expect(page.locator("main").getByText(NOTE_TITLE).first()).toBeVisible();

    await open(page, "/projects/pry_kairos_web?tab=notes");
    await expect(page.locator("main").getByText(NOTE_TITLE).first()).toBeVisible();
  });
});

test.describe("HU-29 activity is read-only (mutates a client)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("CA2: no edit or delete control on any activity entry, and a client edit shows its field diff", async ({
    page,
  }) => {
    await open(page, "/clients/cli_zafiro_labs/edit");
    await page.getByLabel("Nombre comercial", { exact: true }).fill("Zafiro Labs E2E");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Cliente actualizado", { exact: true })).toBeVisible();

    await open(page, "/clients/cli_zafiro_labs?tab=activity");
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
    await expect(sheet.getByText("Zafiro Labs E2E", { exact: true }).first()).toBeVisible();
  });
});

// ───────────────────────────── Roles (View as role) ─────────────────────────────

test.describe("roles (View as role)", () => {
  test("Miembro edits a project but cannot create one or archive a client", async ({ page }) => {
    await viewAsRole(page, "Miembro");
    await open(page, "/projects/pry_kairos_web");
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toBeVisible();

    await open(page, "/projects/list");
    await expect(page.getByRole("link", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);

    await open(page, "/clients/cli_zafiro_labs");
    const more = page.getByRole("button", { name: "Más acciones", exact: true });
    if ((await more.count()) > 0) {
      await more.click();
      await expect(
        page.getByRole("menuitem", { name: "Archivar cliente", exact: true }),
      ).toHaveCount(0);
    }
  });

  test("Miembro sees no finance tabs on a client and no money columns on the lists", async ({
    page,
  }) => {
    await viewAsRole(page, "Miembro");
    await open(page, "/clients/cli_kairos");
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

  test("Miembro archives only own notes: the archive control is missing on at least one note", async ({
    page,
  }) => {
    await viewAsRole(page, "Miembro");
    await open(page, "/notes");
    const rows = page.getByRole("row").filter({ has: page.getByRole("cell") });
    const archiveControls = page.getByRole("button", { name: /^Archivar / });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    expect(await archiveControls.count()).toBeLessThan(rowCount);
  });

  test("Lector sees no write action on the clients, projects and notes screens", async ({
    page,
  }) => {
    await viewAsRole(page, "Lector");
    await open(page, "/clients/list");
    await expect(page.getByRole("link", { name: "Nuevo cliente", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nuevo cliente", exact: true })).toHaveCount(0);

    await open(page, "/clients/cli_kairos");
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toHaveCount(0);

    await open(page, "/projects/list");
    await expect(page.getByRole("link", { name: "Nuevo proyecto", exact: true })).toHaveCount(0);

    await open(page, "/notes");
    await expect(page.getByRole("link", { name: "Nueva nota", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Archivar / })).toHaveCount(0);
  });
});

// ───────────────────────────── Navigation sweep ─────────────────────────────

const H1_B2_ROUTES = [
  "/clients",
  "/clients/list",
  "/clients/new",
  "/clients/cli_kairos",
  "/clients/cli_kairos/edit",
  "/projects",
  "/projects/list",
  "/projects/new",
  "/projects/pry_kairos_web",
  "/projects/pry_kairos_web/edit",
  "/notes",
  "/notes/new",
  "/notes/note_kairos_alcance",
  "/activity",
  "/settings/tags",
  "/settings/technologies",
];

test.describe("navigation sweep (read only)", () => {
  for (const path of H1_B2_ROUTES) {
    const check = async (page: Page) => {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(sidebar(page), path).toBeVisible();
      await expect(notFoundText(page), path).toHaveCount(0);

      const heading = page.locator("main h1").first();
      await expect(heading, path).toBeVisible();
      const text = (await heading.innerText()).trim();
      expect(text.length, `${path} has a heading`).toBeGreaterThan(0);
      expect(RAW_KEY.test(text), `${path} shows a raw key: ${text}`).toBe(false);
    };

    test(`renders ${path} in the shell with a translated heading`, async ({ page }) => {
      await check(page);
    });
  }

  test("unknown ids and the graph route render the in-shell 404 page", async ({ page }) => {
    for (const path of [
      "/clients/cli_no_existe",
      "/projects/pry_no_existe",
      "/notes/note_no_existe",
      "/clients/cli_kairos/graph",
    ]) {
      await page.goto(path);
      await expect(notFoundText(page), path).toBeVisible();
      await expect(sidebar(page), path).toBeVisible();
    }
  });

  test("the notes, graph and unknown note routes answer HTTP 404", async ({ page }) => {
    for (const path of ["/notes/note_no_existe", "/clients/cli_kairos/graph"]) {
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
  test("keyboard moves through the client form fields in order", async ({ page }) => {
    await open(page, "/clients/new");
    const tradeName = page.getByLabel("Nombre comercial", { exact: true });
    await tradeName.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Razón social", { exact: true })).toBeFocused();
  });

  test("keyboard moves through the project form fields in order", async ({ page }) => {
    await open(page, "/projects/new");
    await page.getByLabel("Nombre", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Clientes", exact: true })).toBeFocused();
  });

  // PRODUCT DEFECT D5 (minor, a11y WCAG 2.4.3), still present after fix package 3.8: route /clients/cli_zafiro_labs?tab=contacts,
  // focus the "Nuevo contacto" button, Enter, Escape. The dialog closes but document.activeElement is BODY, not the opener
  // (reproduced in headless Chromium on the integrated build, :3105). Likely cause, from reading use-opener-focus.ts:
  // ContactFormDialog is mounted with key={dialog.key} and open=true in one commit, so its useRef(open) starts true and the
  // hook never records the opener. Remove test.fail once the opener receives focus after Escape.
  test.fail(
    "Escape closes the contact dialog and returns focus to its opener",
    async ({ page }) => {
      await open(page, "/clients/cli_zafiro_labs?tab=contacts");
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
    await open(page, "/clients/cli_kairos");
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

test.describe("locale on a detail page (mutates mock preferences)", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("switching ES to EN reformats the dates and money of a project detail", async ({ page }) => {
    await open(page, "/projects/pry_kairos_web");
    const before = await page.locator("main").innerText();

    await page.getByRole("button", { name: "Idioma", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Search\b/ })).toBeVisible();

    const after = await page.locator("main").innerText();
    // Dates and money are rendered per locale (HU-30 CA1): the same record reads differently in EN.
    expect(after).not.toBe(before);
  });
});

// ───────────────────────────── Responsive: no horizontal page scroll ─────────────────────────────

const RESPONSIVE_ROUTES = [
  "/clients/list",
  "/clients/cli_kairos",
  "/projects/list",
  "/projects/pry_kairos_web",
  "/notes",
];

async function expectNoHorizontalScroll(page: Page, path: string) {
  await open(page, path);
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${path} has no horizontal page scroll`).toBeLessThanOrEqual(client);
}

test.describe("responsive desktop", () => {
  test("the main lists and detail pages fit the desktop width", async ({ page }) => {
    for (const path of RESPONSIVE_ROUTES) {
      await expectNoHorizontalScroll(page, path);
    }
  });
});

test.describe("responsive tablet 820×1180", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("the main lists and detail pages fit the tablet width without horizontal page scroll", async ({
    page,
  }) => {
    for (const path of RESPONSIVE_ROUTES) {
      await expectNoHorizontalScroll(page, path);
    }
  });
});

// ───────────────────────────── Dark mode contrast (spot check) ─────────────────────────────

test.describe("dark mode contrast (read only)", () => {
  test("a heading on a detail page meets WCAG AA contrast in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await open(page, "/clients/cli_kairos");
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    expect(await headingContrast(page)).toBeGreaterThanOrEqual(4.5);
  });
});
