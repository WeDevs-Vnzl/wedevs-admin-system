import { expect, test, type Page } from "@playwright/test";

// Wave 5 shell E2E (H1-B1, TASK.md "Tester scope"). This file starts nothing: it runs against the app that
// PLAYWRIGHT_BASE_URL points to (safeguards.md rule 1). The app serves in-memory MOCK data from one process, so
// the tests that change mock state (preferences, locale, theme) run serially and restore it with the user
// menu's "Restablecer datos de prueba" after each test. View-as-role lives in the cookie of each context.

const RATE_ES = /1 USD = Bs\. \d{1,3}(?:\.\d{3})*,\d{2}/;
const RATE_EN = /1 USD = Bs\. \d{1,3}(?:,\d{3})*\.\d{2}/;
const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Navegación principal" });
const commandMenu = (page: Page) => page.getByRole("dialog", { name: "Menú de comandos" });

/** Restores the mock data (preferences, locale, theme) through the user menu. Locale-agnostic on purpose. */
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

/** Sets the MOCK role of this context through "Ver como rol" in the user menu (cookie only, no shared state). */
async function viewAsRole(page: Page, role: "Lector" | "Miembro") {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle"); // menus open only after hydration; clicks fired earlier are lost
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Ver como rol" }).hover();
  await page.getByRole("menuitemradio", { name: role, exact: true }).click();
  await expect(page.getByText(`Ahora ves la aplicación como ${role}`)).toBeVisible();
}

test.describe("routing and sign-in", () => {
  test("/ redirects to /dashboard inside the shell", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(sidebar(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
  });

  test("/sign-in renders outside the shell with no counters and its button reaches /dashboard", async ({
    page,
  }) => {
    const response = await page.goto("/sign-in");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
    await expect(sidebar(page)).toHaveCount(0);
    await expect(mainNav(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Menú de usuario" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Buscar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Alertas/ })).toHaveCount(0);

    await page.getByRole("link", { name: "Continuar con Google", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("every sidebar link (Owner) resolves to a page or the in-shell not-found", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(mainNav(page)).toBeVisible();

    // "Clientes", "Proyectos", "Notas" and "Actividad" exist since H1-B2; the links below are still in-shell not-found.
    for (const [label, url] of [
      ["Clientes", /\/clients$/],
      ["Proyectos", /\/projects$/],
      ["Notas", /\/notes$/],
      ["Actividad", /\/activity$/],
    ] as const) {
      await sidebar(page).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByText("Página no encontrada", { exact: true })).toHaveCount(0);
      await expect(mainNav(page)).toBeVisible();
    }

    const notFoundLinks = [
      "Facturas",
      "Pagos",
      "Gastos",
      "Cuentas",
      "Documentos",
      "Grafo",
      "Reportes",
    ];
    for (const label of notFoundLinks) {
      await sidebar(page).getByRole("link", { name: label, exact: true }).click();
      await expect(page.getByText("Página no encontrada", { exact: true })).toBeVisible();
      await expect(sidebar(page)).toBeVisible();
      await expect(mainNav(page)).toBeVisible();
    }

    await sidebar(page).getByRole("link", { name: "Inicio", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Página no encontrada", { exact: true })).toHaveCount(0);

    await sidebar(page).getByRole("link", { name: "Configuración", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.getByRole("combobox", { name: "Zona horaria" })).toBeVisible();
  });

  test("unknown routes return the in-shell not-found with HTTP 404; the other routes stay unaffected", async ({
    page,
  }) => {
    // `/clients/cli_kairos/graph` is H1-B5; `/clients` itself is a page since H1-B2.
    for (const path of ["/clients/cli_kairos/graph", "/settings/preferences/x"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByText("Página no encontrada", { exact: true })).toBeVisible();
      await expect(sidebar(page)).toBeVisible();
    }

    const dashboard = await page.goto("/dashboard");
    expect(dashboard?.status()).toBe(200);
    const company = await page.goto("/settings/company");
    expect(company?.status()).toBe(200);
    await expect(page.getByText("Próximamente", { exact: true })).toBeVisible();
    await expect(sidebar(page)).toBeVisible();

    const signIn = await page.goto("/sign-in");
    expect(signIn?.status()).toBe(200);
  });
});

test.describe("command menu", () => {
  test("Ctrl+K and Cmd+K open and close the command menu", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    await expect(commandMenu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(commandMenu(page)).toBeHidden();

    await page.keyboard.press("Meta+k");
    await expect(commandMenu(page)).toBeVisible();
  });

  test("typing a Spanish label filters the list and Enter navigates", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    const dialog = commandMenu(page);
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder("Escribe un comando o busca…").pressSequentially("factu");
    await expect(dialog.getByRole("option", { name: "Facturas", exact: true })).toBeVisible();
    await expect(dialog.getByRole("option", { name: "Clientes", exact: true })).toBeHidden();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/invoices$/);
  });
});

test.describe("locale and theme (mutate mock preferences)", () => {
  test.describe.configure({ mode: "serial" });
  test.afterEach(async ({ page }) => {
    await resetMockData(page);
  });

  test("ES to EN via the topbar translates the shell and reformats the BCV rate chip", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Tasa BCV/ })).toContainText(RATE_ES);

    await page.getByRole("button", { name: "Idioma", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "English", exact: true }).click();

    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /BCV rate/ })).toContainText(RATE_EN);

    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Español", exact: true }).click();
    await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Tasa BCV/ })).toContainText(RATE_ES);
  });

  test("theme toggle persists across reload", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Cambiar tema", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Oscuro", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
  });

  test("preferences form saves language, theme and time zone and survives reload", async ({
    page,
  }) => {
    await page.goto("/settings/preferences");
    await page.getByRole("radio", { name: "English", exact: true }).click();
    await page.getByRole("radio", { name: "Oscuro", exact: true }).click();
    await page.getByRole("combobox", { name: "Zona horaria" }).click();
    await page.getByRole("option", { name: "America/Bogota", exact: true }).click();
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(page.getByText("Preferencias guardadas", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "English", exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    await expect(page.getByRole("combobox", { name: /Zona horaria|Time zone/ })).toContainText(
      "America/Bogota",
    );
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
  });
});

test.describe("roles (View as role)", () => {
  test("View as Viewer hides write quick actions and still reaches Configuración → Preferencias", async ({
    page,
  }) => {
    await viewAsRole(page, "Lector");

    await page.keyboard.press("Control+k");
    const dialog = commandMenu(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Acciones rápidas", { exact: true })).toBeHidden();
    await expect(dialog.getByRole("option", { name: "Nuevo cliente", exact: true })).toBeHidden();
    await expect(dialog.getByRole("option", { name: "Nueva factura", exact: true })).toBeHidden();
    await expect(dialog.getByRole("option", { name: "Registrar pago", exact: true })).toBeHidden();
    await dialog.getByRole("option", { name: "Configuración", exact: true }).click();

    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.getByRole("combobox", { name: "Zona horaria" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuarios", exact: true })).toHaveCount(0);
  });

  test("View as Member reaches Configuración → Preferencias from the sidebar", async ({ page }) => {
    await viewAsRole(page, "Miembro");

    await sidebar(page).getByRole("link", { name: "Configuración", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.getByRole("combobox", { name: "Zona horaria" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuarios", exact: true })).toHaveCount(0);
  });
});

test.describe("keyboard", () => {
  test("Tab reaches the sidebar, then the topbar controls, in order", async ({ page }) => {
    await page.goto("/dashboard");

    const focused: string[] = [];
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      focused.push(
        await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          return element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? "";
        }),
      );
    }

    // WCAG 2.4.1: the skip link is the first focusable element of the shell.
    expect(focused[0], "the skip link is the first Tab stop").toBe("Saltar al contenido");

    const order = [
      "Inicio",
      "Configuración",
      "Contraer barra lateral",
      "Buscar",
      "Idioma",
      "Cambiar tema",
      "Menú de usuario",
    ];
    const positions = order.map((label) => focused.indexOf(label));
    for (let index = 0; index < order.length; index += 1) {
      const position = positions[index] ?? -1;
      expect(position, `"${order[index]}" is reached by Tab`).toBeGreaterThanOrEqual(0);
      if (index > 0) {
        const previous = positions[index - 1] ?? -1;
        expect(position, `"${order[index]}" comes after "${order[index - 1]}"`).toBeGreaterThan(
          previous,
        );
      }
    }
  });

  test("the skip link moves focus to the page content", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Saltar al contenido", exact: true });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("Escape closes the command menu and returns focus to the trigger", async ({ page }) => {
    await page.goto("/dashboard");
    // Enter only opens the menu once React has hydrated the trigger's onClick; wait for that first.
    await page.waitForLoadState("networkidle");
    const trigger = page.getByRole("button", { name: "Buscar", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = commandMenu(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Escribe un comando o busca…")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("responsive and dark mode", () => {
  test.describe("tablet 820×1180", () => {
    test.use({ viewport: { width: 820, height: 1180 } });

    test("the sidebar collapses to icons and opens again, without a mobile sheet", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");

      await page.getByRole("button", { name: "Contraer barra lateral", exact: true }).click();
      await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed");
      await expect(page.locator('[data-mobile="true"]')).toHaveCount(0);

      await page.getByRole("button", { name: "Expandir barra lateral", exact: true }).click();
      await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");
    });
  });

  test("dark mode: the shell renders with the dark class", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto("/dashboard");

    await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    await expect(mainNav(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Menú de usuario" })).toBeVisible();
  });
});
