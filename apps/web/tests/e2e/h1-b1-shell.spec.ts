import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import { loadRateViaUi } from "./support/ui-data";

// Wave 5 shell E2E (H1-B1, docs/TASK.md "Tester scope"), FE-INT-R E.3. Runs against PLAYWRIGHT_BASE_URL with the local
// BE (safeguards.md rule 1); nothing here starts a server. Every test signs in as the Owner through the Clerk test
// user (DT-204) instead of the retired mock role cookie. Tests that change the Owner's preferences (locale, theme,
// time zone) restore them through the preferences form after each test, so the next test starts from Español,
// Claro and America/Caracas. The `@unauthenticated` sign-in case runs in the `unauthenticated` project.

const RATE_ES = /1 USD = Bs\. \d{1,3}(?:\.\d{3})*,\d{2}/;
const RATE_EN = /1 USD = Bs\. \d{1,3}(?:,\d{3})*\.\d{2}/;
const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Navegación principal" });
const commandMenu = (page: Page) => page.getByRole("dialog", { name: "Menú de comandos" });

/** Restores the Owner's preferences (Español, Claro, America/Caracas) through the preferences form. */
async function restorePreferences(page: Page) {
  await page.goto("/settings/preferences");
  await page.waitForLoadState("networkidle"); // the form submits only after hydration
  await page.getByRole("radio", { name: "Español", exact: true }).click();
  await page.getByRole("radio", { name: "Claro", exact: true }).click();
  await page.getByRole("combobox", { name: /Zona horaria|Time zone/ }).click();
  await page.getByRole("option", { name: "America/Caracas", exact: true }).click();
  await page.getByRole("button", { name: /^(Guardar cambios|Save changes)$/ }).click();
  await expect(page.getByText(/^(Preferencias guardadas|Preferences saved)$/)).toBeVisible();
}

test.describe("sign-in page (no session)", () => {
  test("@unauthenticated /sign-in renders outside the shell with no counters and offers Google sign-in", async ({
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
    // The Google button starts Clerk's OAuth flow, which is external: only its presence is checked here.
    await expect(page.getByRole("button", { name: "Continuar con Google", exact: true })).toBeVisible();
  });
});

test.describe("routing", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("/ redirects to /dashboard inside the shell", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(sidebar(page)).toBeVisible();
    // The dashboard heading is the greeting of the part of the day ("Buenas tardes, <name>"), not "Inicio".
    await expect(
      page.getByRole("heading", { level: 1, name: /^(Buenos días|Buenas tardes|Buenas noches), / }),
    ).toBeVisible();
  });

  test("every sidebar link (Owner) resolves to a real page", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(mainNav(page)).toBeVisible();

    // Every link resolves to a real page since H1-B2 (CRM), H1-B3 (finance) and H1-B4/B5 (documents, graph,
    // reports); none lands on the in-shell not-found.
    for (const [label, url] of [
      ["Clientes", /\/clients$/],
      ["Proyectos", /\/projects$/],
      ["Notas", /\/notes$/],
      ["Actividad", /\/activity$/],
      ["Facturas", /\/invoices$/],
      ["Pagos", /\/payments$/],
      ["Gastos", /\/expenses$/],
      ["Cuentas", /\/accounts$/],
      ["Documentos", /\/documents(\/|$)/],
      ["Grafo", /\/graph$/],
      ["Reportes", /\/reports$/],
    ] as const) {
      await sidebar(page).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByText("Página no encontrada", { exact: true })).toHaveCount(0);
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
    // No seeded id is used: a client id that does not exist answers the in-shell not-found (its graph route).
    for (const path of ["/clients/cli_no_existe/graph", "/settings/preferences/x"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByText("Página no encontrada", { exact: true })).toBeVisible();
      await expect(sidebar(page)).toBeVisible();
    }

    const dashboard = await page.goto("/dashboard");
    expect(dashboard?.status()).toBe(200);
    const company = await page.goto("/settings/company");
    expect(company?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /^(Empresa|Company)$/ })).toBeVisible();
    await expect(sidebar(page)).toBeVisible();

    const signIn = await page.goto("/sign-in");
    expect(signIn?.status()).toBe(200);
  });
});

test.describe("command menu", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

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

test.describe("locale and theme (mutate the Owner's preferences)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });
  test.afterEach(async ({ page }) => {
    // The page is still signed in from `beforeEach`: a second `signInAs` would fail on the signed-in session.
    await restorePreferences(page);
  });

  test("ES to EN via the topbar translates the shell and reformats the BCV rate chip", async ({
    page,
  }) => {
    // A fresh BE has no rate: the chip would show "Sin tasa para hoy". Load today's BCV rate through the rates UI.
    await loadRateViaUi(page, "VES", "36.50");
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
    await signInAs(page, "VIEWER");

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
    await signInAs(page, "MEMBER");

    await sidebar(page).getByRole("link", { name: "Configuración", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.getByRole("combobox", { name: "Zona horaria" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuarios", exact: true })).toHaveCount(0);
  });
});

test.describe("keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

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
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

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
