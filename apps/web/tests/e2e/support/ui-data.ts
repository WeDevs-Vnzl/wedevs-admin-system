import { expect, type Page } from "@playwright/test";

// FE-INT-R E.3. Data for the E2E specs is created through the UI with unique names (W5 rule 29): the BE seed holds
// catalogs and settings only, so no spec relies on a client or project that another spec created. These helpers
// drive the real create forms; they never call the BE directly and never read a seeded id.

/** Opens a page and waits until React has hydrated it (clicks fired before that are lost). */
export async function openPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Reads the record id from the URL segment that follows `prefix` (for example `/clients/` → `cli_…`). */
function idFromUrl(page: Page, prefix: string): string {
  const match = new RegExp(`${prefix}([^/?#]+)`).exec(new URL(page.url()).pathname);
  if (!match?.[1]) throw new Error(`No record id after ${prefix} in ${page.url()}`);
  return match[1];
}

/**
 * Creates a person client in Colombia through /clients/new (address and E.164 phone are required) and returns its id.
 * `taxId` must be unique per run (use `Date.now()` in the caller).
 */
export async function createClientViaUi(page: Page, tradeName: string, taxId: string): Promise<string> {
  await openPage(page, "/clients/new");
  await page.getByLabel("Nombre comercial", { exact: true }).fill(tradeName);
  await page.getByLabel("Identificador fiscal", { exact: true }).fill(taxId);
  // A Venezuelan tax id has a fixed format; Colombia accepts the free E2E id.
  await page.getByRole("combobox", { name: "País", exact: true }).click();
  await page.getByRole("option", { name: "Colombia" }).click();
  await page.getByLabel("Dirección", { exact: true }).fill("Calle E2E 1");
  await page.locator("#client-phone").fill("+57 300 123 4567");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/cli_/);
  return idFromUrl(page, "/clients/");
}

/** One client linked to a project, with the role it plays in that project. */
export interface ProjectClientLink {
  clientName: string;
  role: string;
}

/**
 * Creates a project through /projects/new linked to the given clients and returns its id (`pry_…`). The clients must
 * exist already (created by `createClientViaUi` in the same spec, with their trade names).
 */
export async function createProjectViaUi(
  page: Page,
  options: { name: string; summary?: string; clients: ProjectClientLink[]; technology?: string },
): Promise<string> {
  await openPage(page, "/projects/new");
  await page.getByLabel("Nombre", { exact: true }).fill(options.name);
  if (options.summary) {
    await page.getByLabel("Resumen", { exact: true }).fill(options.summary);
  }

  const clients = page.getByRole("combobox", { name: "Clientes", exact: true });
  for (const link of options.clients) {
    await clients.fill(link.clientName);
    await page.getByRole("option", { name: link.clientName, exact: true }).click();
    await page
      .getByRole("textbox", { name: `Rol: ${link.clientName}`, exact: true })
      .fill(link.role);
  }

  if (options.technology) {
    await page.locator("#project-stack").click();
    await page.getByRole("option", { name: options.technology, exact: true }).click();
    await page.keyboard.press("Escape");
  }

  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText(/Proyecto PRY-\d{4} creado/)).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/pry_/);
  return idFromUrl(page, "/projects/");
}
