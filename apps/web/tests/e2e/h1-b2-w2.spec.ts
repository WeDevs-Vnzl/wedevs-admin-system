import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";

// Wave 2 E2E (H1-B2, docs/TASK.md "Tester scope"), kept by FE-INT-R E.1. This file starts nothing: it runs against
// the app that PLAYWRIGHT_BASE_URL points to (safeguards.md rule 1). Every case creates its own data through the UI
// with a unique name (FE-INT-R rule 29); the BE seed holds catalogs only (technologies are catalogs), so no case
// relies on a project, alert or activity entry it did not create. Cases that need such data are `test.fixme`.
// View-as-role lives in the cookie of each context.

const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;
const ALERTS_BADGE = '[data-slot="alerts-badge"]';

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');
const notFoundText = (page: Page) => page.getByText("Página no encontrada", { exact: true });

const alertsBell = (page: Page) => page.getByRole("button", { name: /^Alertas/ });
const alertsPanel = (page: Page) => page.getByRole("dialog", { name: "Alertas", exact: true });
const alertsList = (page: Page) => page.getByRole("list", { name: "Lista de alertas", exact: true });

/** The bell counter as shown (the badge is aria-hidden, so its text is read directly); 0 when not rendered. */
async function badgeValue(page: Page): Promise<number> {
  const badge = page.locator(ALERTS_BADGE);
  if ((await badge.count()) === 0) return 0;
  return Number((await badge.innerText()).trim());
}

/** Opens the bell panel on the dashboard and waits for the list to load. */
async function openAlerts(page: Page) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await alertsBell(page).click();
  await expect(alertsPanel(page)).toBeVisible();
  await expect(alertsList(page)).toBeVisible();
}

/** WCAG contrast ratio of the bell counter (text over its background), measured in the browser. */
async function badgeContrast(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const badge = document.querySelector<HTMLElement>(selector);
    if (!badge) throw new Error("the bell counter is not rendered");
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
    const style = getComputedStyle(badge);
    const text = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
  }, ALERTS_BADGE);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Creates a technology from the catalogue table's dialog; `nameEn` is optional. */
async function createTechnology(page: Page, name: string, nameEn?: string) {
  await page.goto("/settings/technologies");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Nueva tecnología", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva tecnología", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nombre", { exact: true }).fill(name);
  if (nameEn) await dialog.getByLabel("Nombre en inglés (opcional)", { exact: true }).fill(nameEn);
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(page.getByText("Tecnología creada", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
}

// ───────────────────────────── Tags (/settings/tags) ─────────────────────────────

test.describe("tags (mutates tags)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });
  test.describe.configure({ mode: "serial" });

  test("Owner creates, renames and recolours a tag", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const name = `E2E etiqueta ${suffix}`;
    const renamed = `${name} editada`;

    await page.goto("/settings/tags");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Etiquetas", exact: true })).toBeVisible();

    // Create: the dialog is labelled by its title and the swatch is a radio of the preset group.
    await page.getByRole("button", { name: "Nueva etiqueta", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Nueva etiqueta", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nombre", { exact: true }).fill(name);
    await dialog.getByRole("radio", { name: "Color #059669", exact: true }).click();
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Etiqueta creada", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder("Buscar etiquetas…").fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // Rename: the edit button of the row carries the tag name.
    await row.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Editar etiqueta", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nombre", { exact: true }).fill(renamed);
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Etiqueta guardada", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder("Buscar etiquetas…").fill(renamed);
    const renamedRow = page.getByRole("row").filter({ hasText: renamed });
    await expect(renamedRow).toBeVisible();

    // Recolour: pick another preset, save, and the edit form starts from the saved colour.
    await renamedRow.getByRole("button", { name: `Editar ${renamed}`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Editar etiqueta", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Color #dc2626", exact: true }).click();
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Etiqueta guardada", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();

    await renamedRow.getByRole("button", { name: `Editar ${renamed}`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Editar etiqueta", exact: true });
    await expect(dialog.getByLabel("Color hexadecimal", { exact: true })).toHaveValue("#dc2626");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("tags access (view as role)", () => {
  for (const [role, key] of [
    ["Miembro", "MEMBER"],
    ["Lector", "VIEWER"],
  ] as const) {
    test(`${role} gets the in-shell not-found on /settings/tags`, async ({ page }) => {
      await signInAs(page, key);
      await page.goto("/settings/tags");
      await expect(notFoundText(page)).toBeVisible();
      await expect(sidebar(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "Nueva etiqueta", exact: true })).toHaveCount(
        0,
      );
    });
  }
});

// ───────────────────────────── Technologies (/settings/technologies) ─────────────────────────────

test.describe("technologies (mutates the catalogue)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });
  test.describe.configure({ mode: "serial" });

  test("create with an English name; EN locale shows the English name", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const name = `E2E tec ${suffix}`;
    const nameEn = `E2E tech ${suffix}`;
    await createTechnology(page, name, nameEn);

    // The URL search is read by the server page, so the new row is found with `?q=`.
    await page.goto(`/settings/technologies?q=${suffix}`);
    await page.waitForLoadState("networkidle");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(nameEn); // the "Nombre en inglés" column, in both locales
    await expect(row.locator(".font-medium").first()).toHaveText(name); // Spanish locale: `name`

    await page.getByRole("button", { name: "Idioma", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
    await expect(page.getByRole("button", { name: "Language", exact: true })).toBeVisible();

    const enRow = page.getByRole("row").filter({ hasText: nameEn });
    await expect(enRow).toBeVisible();
    await expect(enRow.locator(".font-medium").first()).toHaveText(nameEn); // EN locale: `nameEn`
  });

  test("delete of an unused technology works", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const name = `E2E sin uso ${suffix}`;
    await createTechnology(page, name);

    await page.goto(`/settings/technologies?q=${suffix}`);
    await page.waitForLoadState("networkidle");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Sin proyectos");

    await page.getByRole("button", { name: `Eliminar ${name}`, exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(`«${name}» se eliminará del catálogo.`);
    await confirm.getByRole("button", { name: "Eliminar", exact: true }).click();

    await expect(page.getByText("Tecnología eliminada", { exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  });

  test.fixme(
    "FE-INT-R E.1: delete of an in-use technology is refused and deactivation is offered; needs a project that uses the technology, and the BE seed holds no projects (rule 29)",
    async ({ page }) => {
      await page.goto("/settings/technologies?q=next-js");
      await page.waitForLoadState("networkidle");
      const row = page.getByRole("row").filter({ hasText: "next-js" });
      await expect(row).toBeVisible();
      await expect(row).not.toContainText("Sin proyectos");

      await page.getByRole("button", { name: "Eliminar Next.js", exact: true }).click();
      const notice = page.getByRole("alertdialog", { name: "Tecnología en uso", exact: true });
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("Desactivar");
      await expect(notice.getByRole("button", { name: "Eliminar", exact: true })).toHaveCount(0);

      await notice.getByRole("button", { name: "Desactivar", exact: true }).click();
      await expect(page.getByText("Tecnología desactivada", { exact: true })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Activar Next.js", exact: true })).toBeVisible();
    },
  );
});

test.describe("technologies access (view as role)", () => {
  for (const [role, key] of [
    ["Miembro", "MEMBER"],
    ["Lector", "VIEWER"],
  ] as const) {
    test(`${role} gets the in-shell not-found on /settings/technologies`, async ({ page }) => {
      await signInAs(page, key);
      await page.goto("/settings/technologies");
      await expect(notFoundText(page)).toBeVisible();
      await expect(sidebar(page)).toBeVisible();
    });
  }
});

test.describe("technologies search (read only)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });
  test("typing in the search filters the rows, not only the URL", async ({ page }) => {
    await page.goto("/settings/technologies");
    await page.waitForLoadState("networkidle");
    const rows = page.locator("table tbody tr");
    const before = await rows.count();
    expect(before).toBeGreaterThan(0); // the catalogue seed (technologies are catalogs, rule 29)

    await page
      .getByPlaceholder(/Buscar/)
      .first()
      .fill("zzz-no-match-xyz");
    await expect(page).toHaveURL(/q=zzz-no-match-xyz/);
    await expect.poll(() => rows.count()).toBeLessThan(before);
  });
});

// ───────────────────────────── Activity (/activity) ─────────────────────────────

test.describe("activity", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });
  test("filters are reflected in the URL and clear together", async ({ page }) => {
    await page.goto("/activity");
    await page.waitForLoadState("networkidle");

    await page.getByRole("combobox", { name: "Acción", exact: true }).click();
    await page.getByRole("option", { name: "Creó", exact: true }).click();
    await expect(page).toHaveURL(/[?&]action=CREATE(&|$)/);

    await page.getByRole("combobox", { name: "Tipo de registro", exact: true }).click();
    await page.getByRole("option", { name: "Factura", exact: true }).click();
    await expect(page).toHaveURL(/entityType=INVOICE/);
    await expect(page).toHaveURL(/action=CREATE/);

    await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
    await expect(page).not.toHaveURL(/action=|entityType=/);
  });

  test("the detail sheet traps focus, closes with Escape and returns focus to its trigger", async ({
    page,
  }) => {
    // Creating a technology writes a CREATE entry, so the feed has an entry this case made itself (rule 29).
    await createTechnology(page, `E2E activity ${Date.now().toString(36)}`);
    await page.goto("/activity");
    await page.waitForLoadState("networkidle");

    const trigger = page.getByRole("button", { name: /^Ver detalle de / }).first();
    await trigger.focus();
    await page.keyboard.press("Enter");

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Este registro es inmutable/)).toBeVisible();

    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      await expect(sheet.locator(":focus")).toHaveCount(1);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test.fixme(
    "FE-INT-R E.1: load more appends the next page of entries; needs more than one page of activity, and the BE seed holds no activity (rule 29)",
    async ({ page }) => {
      await page.goto("/activity");
      await page.waitForLoadState("networkidle");

      const entries = page.locator('section[aria-label^="Eventos del"] li');
      const before = await entries.count();
      const more = page.getByRole("button", { name: "Cargar más", exact: true });
      await expect(more).toBeVisible();
      await more.click();
      await expect.poll(() => entries.count()).toBeGreaterThan(before);
    },
  );

  test("CSV export starts a download that begins with a UTF-8 BOM", async ({ page }) => {
    await page.goto("/activity");
    await page.waitForLoadState("networkidle");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar CSV", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const file = await download.path();
    expect(file).not.toBeNull();
    const bytes = await readFile(file!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

test.describe("activity access (view as role)", () => {
  for (const [role, key] of [
    ["Miembro", "MEMBER"],
    ["Lector", "VIEWER"],
  ] as const) {
    test(`${role} gets the in-shell not-found on /activity`, async ({ page }) => {
      await signInAs(page, key);
      await page.goto("/activity");
      await expect(notFoundText(page)).toBeVisible();
      await expect(sidebar(page)).toBeVisible();
    });
  }
});

// ───────────────────────────── Alerts bell ─────────────────────────────
// Every alert case needs active alerts. The BE raises alerts from finance and document data, and the BE seed holds
// none, so each case is `test.fixme` until a case creates the data it needs (rule 29). The bodies stay as the spec.

test.describe("alerts bell (read only)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });
  test.fixme(
    "FE-INT-R E.1: the counter equals the panel items, and the panel is labelled; needs active alerts, which the BE seed does not hold (rule 29)",
    async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      const counter = await badgeValue(page);
      expect(counter, "the alerts exist for the Owner").toBeGreaterThan(0);

      await alertsBell(page).click();
      await expect(alertsPanel(page)).toBeVisible();
      await expect(alertsPanel(page)).toHaveAttribute("aria-labelledby", /.+/);
      await expect(alertsList(page)).toBeVisible();
      await expect(alertsList(page).getByRole("listitem")).toHaveCount(counter);
    },
  );

  test.fixme(
    "FE-INT-R E.1: dismiss and snooze buttons carry the alert subject in their accessible name; needs active alerts, which the BE seed does not hold (rule 29)",
    async ({ page }) => {
      await openAlerts(page);
      const list = alertsList(page);
      const dismissNames = await list
        .getByRole("button", { name: /^Descartar: / })
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
      expect(dismissNames.length).toBeGreaterThan(0);
      expect(new Set(dismissNames).size, "each row has its own name").toBe(dismissNames.length);
      expect(dismissNames.some((name) => name.includes(" · "))).toBe(true);

      const first = list.getByRole("listitem").first();
      const title = (await first.locator('[data-slot="item-title"]').innerText()).trim();
      await expect(
        first.getByRole("button", { name: new RegExp(`^Descartar: ${escapeRegExp(title)}`) }),
      ).toBeVisible();
      await expect(
        first.getByRole("button", { name: new RegExp(`^Posponer: ${escapeRegExp(title)}`) }),
      ).toBeVisible();
    },
  );

  test.fixme(
    "FE-INT-R E.1: Escape closes the panel and returns focus to the bell; needs active alerts, which the BE seed does not hold (rule 29)",
    async ({ page }) => {
      await openAlerts(page);
      // The panel takes focus on its own container when it opens (no inner control is focused).
      await expect(alertsPanel(page)).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(alertsPanel(page)).toBeHidden();
      await expect(alertsBell(page)).toBeFocused();
    },
  );

  test.fixme(
    "FE-INT-R E.1: the counter badge meets WCAG AA in light and dark mode; needs a visible counter, which needs active alerts the BE seed does not hold (rule 29)",
    async ({ page }) => {
      // Not addInitScript: an init script re-runs on reload and would reset the theme set below.
      await page.goto("/dashboard");
      await page.evaluate(() => localStorage.setItem("theme", "light"));
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator(ALERTS_BADGE)).toBeVisible();
      await expect(page.locator("html")).not.toHaveClass(DARK_CLASS);
      expect(await badgeContrast(page)).toBeGreaterThanOrEqual(4.5);

      await page.evaluate(() => localStorage.setItem("theme", "dark"));
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveClass(DARK_CLASS);
      await expect(page.locator(ALERTS_BADGE)).toBeVisible();
      expect(await badgeContrast(page)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

test.describe("alerts bell (mutates alert state)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });
  test.describe.configure({ mode: "serial" });

  test.fixme(
    "FE-INT-R E.1: dismiss lowers the counter and the panel; needs active alerts, which the BE seed does not hold (rule 29)",
    async ({ page }) => {
      await openAlerts(page);
      const before = await badgeValue(page);
      expect(before).toBeGreaterThan(0);

      await alertsList(page)
        .getByRole("button", { name: /^Descartar: / })
        .first()
        .click();
      await expect(page.getByText("Alerta descartada", { exact: true })).toBeVisible();
      await expect.poll(() => badgeValue(page)).toBe(before - 1);
      await expect(alertsList(page).getByRole("listitem")).toHaveCount(before - 1);
    },
  );

  test.fixme(
    "FE-INT-R E.1: snooze for one day lowers the counter and the panel; needs active alerts, which the BE seed does not hold (rule 29)",
    async ({ page }) => {
      await openAlerts(page);
      const before = await badgeValue(page);
      expect(before).toBeGreaterThan(0);

      await alertsList(page)
        .getByRole("button", { name: /^Posponer: / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "1 día", exact: true }).click();
      await expect(page.getByText("Alerta pospuesta 1 día", { exact: true })).toBeVisible();
      await expect.poll(() => badgeValue(page)).toBe(before - 1);
      await expect(alertsList(page).getByRole("listitem")).toHaveCount(before - 1);
    },
  );
});
