import { expect, type Locator, type Page } from "@playwright/test";

// FE-INT-R E.3. Data for the E2E specs is created through the UI with unique names (W5 rule 29): the BE seed holds
// catalogs and settings only, so no spec relies on a client or project that another spec created. These helpers
// drive the real create forms; they never call the BE directly and never read a seeded id.

/** Opens a page and waits until React has hydrated it (clicks fired before that are lost). */
export async function openPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Matches a record URL segment: the BE issues opaque CUID2 ids (lowercase letters and digits, no entity prefix), so
 * route words such as `new` or `list` never match.
 */
const RECORD_ID = "[a-z0-9]{20,}";

/** A URL that ends in `/<collection>/<record id>`, optionally followed by a query or fragment. */
function recordUrl(collection: string): RegExp {
  return new RegExp(`/${collection}/${RECORD_ID}(?:[?#].*)?$`);
}

/** Reads the record id from the URL segment that follows `prefix` (for example `/clients/`). */
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
  await expect(page).toHaveURL(recordUrl("clients"));
  return idFromUrl(page, "/clients/");
}

/** One client linked to a project, with the role it plays in that project. */
export interface ProjectClientLink {
  clientName: string;
  role: string;
}

/**
 * Creates a project through /projects/new linked to the given clients and returns its id. The clients must
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
  await expect(page).toHaveURL(recordUrl("projects"));
  return idFromUrl(page, "/projects/");
}

/** The Caracas calendar day (YYYY-MM-DD), the day the BE and the forms treat as "today". */
export function caracasToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(now);
}

/**
 * Picks a day in a `DateField` (a button that opens a calendar popover, not a text input, so `fill` does not work).
 * The calendar opens on the month of the selected day, or of today, so `isoDate` must be in that month. Every
 * calendar cell carries its day as `data-day="YYYY-MM-DD"`.
 */
export async function pickDateViaUi(page: Page, trigger: Locator, isoDate: string): Promise<void> {
  await trigger.click();
  await page.locator(`[role="gridcell"][data-day="${isoDate}"] button`).click();
}

/**
 * Loads one BCV rate for today through Settings → Tasas de cambio → Carga rápida (the quick-load dialog lists every
 * active currency except USD and saves only the ones with a value). A rate of the same day and source is replaced.
 */
export async function loadRateViaUi(page: Page, currency: string, usdRate: string): Promise<void> {
  await openPage(page, "/settings/rates");
  await page.getByRole("button", { name: "Carga rápida", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Carga rápida del día", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator(`#quick-load-${currency}`).fill(usdRate);
  await dialog.getByRole("button", { name: "Guardar tasas", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/tasas? guardadas?/).first()).toBeVisible();
}

/**
 * Creates a company account through /accounts/new and returns its id. The account type is the label of the
 * `AccountType` enum in Spanish (default "Billetera digital"); the currency is the catalog code (USD, VES).
 */
export async function createAccountViaUi(
  page: Page,
  options: { name: string; currency: string; type?: string; openingBalance?: string },
): Promise<string> {
  await openPage(page, "/accounts/new");
  await page.getByLabel("Nombre", { exact: true }).fill(options.name);
  if (options.type) {
    await page.locator("#account-type").click();
    await page.getByRole("option", { name: options.type, exact: true }).click();
  }
  await page.locator("#account-currency").click();
  await page.getByRole("option", { name: new RegExp(`^${options.currency} ·`) }).click();
  await page.locator("#account-opening-balance").fill(options.openingBalance ?? "0");
  // The opening date is required; a fixed past day is always valid.
  await page.locator("#account-opening-date").fill("2025-01-01");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Cuenta creada")).toBeVisible();
  await expect(page).toHaveURL(recordUrl("accounts"));
  return idFromUrl(page, "/accounts/");
}

/** An invoice created through the UI: its id and the number the spec typed (the detail header shows it). */
export interface CreatedInvoice {
  id: string;
  invoiceNumber: string;
}

/**
 * Creates an issued USD invoice through /invoices/new with one line (quantity 1, the default IVA rate) and returns
 * it. `price` is the net unit price: at the default 16 % IVA a price of 100 gives a total of 116.
 */
export async function createInvoiceViaUi(
  page: Page,
  options: { clientName: string; invoiceNumber: string; price: string; description?: string },
): Promise<CreatedInvoice> {
  await openPage(page, "/invoices/new");
  await page.locator("#invoice-client").click();
  await page.getByRole("option", { name: options.clientName }).click();
  await page.locator("#invoice-number").fill(options.invoiceNumber);
  await page.locator("#line-0-description").fill(options.description ?? "Servicio E2E");
  await page.locator("#line-0-price").fill(options.price);
  await page.locator('button[type="submit"][form="invoice-form"]').last().click();
  await expect(page.getByText("Factura registrada")).toBeVisible();
  await expect(page).toHaveURL(recordUrl("invoices"), { timeout: 30_000 });
  return { id: idFromUrl(page, "/invoices/"), invoiceNumber: options.invoiceNumber };
}
