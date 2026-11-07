import { expect, type Page, type Response } from "@playwright/test";
import { oneOf } from "./accessible-names";

// Helpers for the specs that change the Owner's preferences (locale, theme, time zone). The locale is stored as a
// preference and mirrored in the NEXT_LOCALE cookie. The cookie outranks the stored value, so a restore clears it
// first and then reads the stored values back.

const NEXT_LOCALE_COOKIE = "NEXT_LOCALE";

/** The `setPreferenceAction` server action: a POST that carries the `next-action` header. */
const isServerAction = (response: Response) =>
  response.request().method() === "POST" && response.request().headers()["next-action"] !== undefined;

/**
 * Switches the locale from the topbar and waits until the preference is saved. The switcher writes the cookie, refreshes
 * and then saves the locale while its button is disabled. A test that ends before the save loses the stored locale.
 */
export async function switchLocaleViaTopbar(page: Page, menuButton: string, option: string): Promise<void> {
  const saved = page.waitForResponse(isServerAction);
  await page.getByRole("button", { name: menuButton, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
  await saved;
  await expect(page.getByRole("button", { name: oneOf("Idioma", "Language"), exact: true })).toBeEnabled();
}

/**
 * Restores the Owner's preferences to Español, Claro and America/Caracas through the preferences form, then reads
 * them back from a page rendered without the cookie (the stored values).
 */
export async function restorePreferences(page: Page): Promise<void> {
  await page.context().clearCookies({ name: NEXT_LOCALE_COOKIE });
  await page.goto("/settings/preferences");
  await page.waitForLoadState("networkidle"); // the form submits only after hydration
  await page.getByRole("radio", { name: "Español", exact: true }).click();
  await page.getByRole("radio", { name: oneOf("Claro", "Light"), exact: true }).click();
  await page.getByRole("combobox", { name: /Zona horaria|Time zone/ }).click();
  await page.getByRole("option", { name: "America/Caracas", exact: true }).click();

  // Save stays disabled while the form matches the stored values, so it is clicked only when something changed.
  const save = page.getByRole("button", { name: oneOf("Guardar cambios", "Save changes"), exact: true });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText(oneOf("Preferencias guardadas", "Preferences saved"))).toBeVisible();
  }

  await page.context().clearCookies({ name: NEXT_LOCALE_COOKIE });
  await page.goto("/settings/preferences");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("radio", { name: "Español", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: oneOf("Claro", "Light"), exact: true })).toBeChecked();
  await expect(page.getByRole("combobox", { name: /Zona horaria|Time zone/ })).toContainText("America/Caracas");
}
