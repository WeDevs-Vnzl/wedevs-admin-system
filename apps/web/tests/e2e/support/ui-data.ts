import { expect, type Locator, type Page } from "@playwright/test";

import { namePrefix } from "./accessible-names";

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
export async function createClientViaUi(
  page: Page,
  tradeName: string,
  taxId: string,
): Promise<string> {
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
  // The summary is required (PRD §8.3, at most 280 characters): a blank one keeps the form from saving.
  await page.getByLabel("Resumen", { exact: true }).fill(options.summary ?? "Resumen E2E");

  const clients = page.getByRole("combobox", { name: "Clientes", exact: true });
  for (const link of options.clients) {
    await clients.fill(link.clientName);
    await page.getByRole("option", { name: namePrefix(link.clientName) }).click();
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

/** The calendar's month buttons (react-day-picker labels, Spanish and English). */
const PREVIOUS_MONTH = /^(Ir al mes anterior|Go to the Previous Month)$/;
const NEXT_MONTH = /^(Ir al mes siguiente|Go to the Next Month)$/;

/**
 * Picks a day in a `DateField` (a button that opens a calendar popover, not a text input, so `fill` does not work).
 * The calendar opens on the month of the selected day, or of today: when `isoDate` is in another month, the helper
 * steps the calendar there with its month buttons. Every calendar cell carries its day as `data-day="YYYY-MM-DD"`.
 */
export async function pickDateViaUi(page: Page, trigger: Locator, isoDate: string): Promise<void> {
  await trigger.click();
  const day = page.locator(`[role="gridcell"][data-day="${isoDate}"] button`);
  for (let step = 0; step < 24 && (await day.count()) === 0; step += 1) {
    // A day in the middle of the grid always belongs to the shown month: its month tells the direction to step.
    const shown = await page
      .locator('[role="gridcell"][data-day]')
      .nth(21)
      .getAttribute("data-day");
    const forward = shown !== null && shown.slice(0, 7) < isoDate.slice(0, 7);
    await page.getByRole("button", { name: forward ? NEXT_MONTH : PREVIOUS_MONTH }).click();
  }
  await day.click();
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
  await page.locator("#invoice-client").fill(options.clientName);
  await page.getByRole("option", { name: namePrefix(options.clientName) }).click();
  await page.locator("#invoice-number").fill(options.invoiceNumber);
  await page.locator("#line-0-description").fill(options.description ?? "Servicio E2E");
  await page.locator("#line-0-price").fill(options.price);
  await page.locator('button[type="submit"][form="invoice-form"]').last().click();
  await expect(page.getByText("Factura registrada")).toBeVisible();
  await expect(page).toHaveURL(recordUrl("invoices"), { timeout: 30_000 });
  return { id: idFromUrl(page, "/invoices/"), invoiceNumber: options.invoiceNumber };
}

/**
 * Gives a project a fixed-price billing plan (when it has none) and adds one pending installment to it through
 * `/projects/[id]/billing`. `dueDate` must be in the current month of the Caracas calendar (the calendar popover opens
 * on it); the default is today, which also puts the installment inside the "Cuota por facturar" alert window.
 */
export async function addInstallmentViaUi(
  page: Page,
  projectId: string,
  options: { label: string; amount: string; dueDate?: string },
): Promise<void> {
  await openPage(page, `/projects/${projectId}/billing`);
  const createPlan = page.getByRole("button", { name: "Crear plan", exact: true });
  if (await createPlan.isVisible()) {
    await page.locator("#plan-contract").fill(options.amount);
    await createPlan.click();
    await expect(page.getByText("Plan de facturación guardado")).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  await page.getByRole("button", { name: "Nueva cuota", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva cuota", exact: true });
  await dialog.getByLabel("Nombre", { exact: true }).fill(options.label);
  await dialog.getByLabel("Monto", { exact: true }).fill(options.amount);
  await pickDateViaUi(
    page,
    dialog.getByLabel("Fecha de facturación", { exact: true }),
    options.dueDate ?? caracasToday(),
  );
  await dialog.getByRole("button", { name: "Crear cuota", exact: true }).click();
  await expect(page.getByText("Cuota creada")).toBeVisible();
}

/** Adds a contact to a client through the "Nuevo contacto" dialog of its Contactos tab. */
export async function createContactViaUi(
  page: Page,
  clientId: string,
  name: string,
  email: string,
): Promise<void> {
  await openPage(page, `/clients/${clientId}?tab=contacts`);
  await page.getByRole("button", { name: "Nuevo contacto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo contacto", exact: true });
  await dialog.getByLabel("Nombre completo", { exact: true }).fill(name);
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Registers a confirmed USD payment (Zelle, not allocated) for a client through /payments/new and returns its id.
 * `accountName` is the name of a USD account created by `createAccountViaUi`; `reference` is required by Zelle.
 */
export async function createUsdPaymentViaUi(
  page: Page,
  options: { clientName: string; accountName: string; amount: string; reference: string },
): Promise<string> {
  await openPage(page, "/payments/new");
  await page.locator("#payment-client").fill(options.clientName);
  await page.getByRole("option", { name: namePrefix(options.clientName) }).click();
  await page.locator("#payment-account").click();
  await page.getByRole("option", { name: `${options.accountName} (USD)`, exact: true }).click();
  await page.locator("#payment-method").click();
  await page.getByRole("option", { name: "Zelle", exact: true }).click();
  await page.locator("#payment-amount").fill(options.amount);
  await page.locator("#payment-reference").fill(options.reference);
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(page.getByText("Pago registrado")).toBeVisible();
  await expect(page).toHaveURL(recordUrl("payments"));
  return idFromUrl(page, "/payments/");
}

/**
 * Registers a pending USD expense through /expenses/new (first category of the catalog) and returns its id. Pass
 * `projectName` to impute it to a project created in the same spec.
 */
export async function createExpenseViaUi(
  page: Page,
  options: { description: string; amount: string; projectName?: string },
): Promise<string> {
  await openPage(page, "/expenses/new");
  await page.locator("#expense-description").fill(options.description);
  await page.locator("#expense-category").click();
  await page.getByRole("option").first().click();
  if (options.projectName) {
    await page.locator("#expense-project").click();
    await page.getByRole("option", { name: options.projectName }).click();
  }
  await page.locator("#expense-amount").fill(options.amount);
  await page.locator('button[type="submit"][form="expense-form"]').click();
  await expect(page.getByText("Gasto registrado")).toBeVisible();
  await expect(page).toHaveURL(recordUrl("expenses"));
  return idFromUrl(page, "/expenses/");
}

/** Creates a monthly recurring expense through /expenses/recurring/new (first category) and returns its id. */
export async function createRecurringExpenseViaUi(
  page: Page,
  options: { name: string; amount: string },
): Promise<string> {
  await openPage(page, "/expenses/recurring/new");
  await page.locator("#recurring-name").fill(options.name);
  await page.locator("#recurring-category").click();
  await page.getByRole("option").first().click();
  await page.locator("#recurring-amount").fill(options.amount);
  await page.locator('button[type="submit"][form="recurring-expense-form"]').click();
  await expect(page.getByText("Gasto recurrente creado")).toBeVisible();
  await expect(page).toHaveURL(/\/expenses\/recurring\/[a-z0-9]{20,}$/);
  return idFromUrl(page, "/expenses/recurring/");
}

/** Creates a note linked to a client through /notes/new?entityType=CLIENT and returns its id. */
export async function createNoteViaUi(
  page: Page,
  options: { clientId: string; title: string },
): Promise<string> {
  await openPage(page, `/notes/new?entityType=CLIENT&entityId=${options.clientId}`);
  await page.locator("#note-title").fill(options.title);
  const editor = page.getByRole("textbox", { name: "Contenido", exact: true });
  await editor.click();
  await editor.pressSequentially("Nota E2E");
  await page.getByRole("button", { name: "Guardar nota", exact: true }).click();
  await expect(page.getByText("Nota creada")).toBeVisible();
  await expect(page).toHaveURL(recordUrl("notes"));
  return idFromUrl(page, "/notes/");
}

/**
 * Creates a document through /documents/new and returns its id. `type` is the Spanish name of a seeded document
 * type ("Propuesta comercial" expires, "PRD" is markdown and opens the editor). `clientId` links it to a client;
 * `expiresToday` sets the expiry date to today (the type must take one).
 */
export async function createDocumentViaUi(
  page: Page,
  options: { title: string; type: string; clientId?: string; expiresToday?: boolean },
): Promise<string> {
  await openPage(
    page,
    options.clientId
      ? `/documents/new?entityType=CLIENT&entityId=${options.clientId}`
      : "/documents/new",
  );
  await page.locator("#document-title").fill(options.title);
  await page.locator("#document-type").click();
  await page.getByRole("option", { name: options.type, exact: true }).click();
  if (options.expiresToday) {
    await pickDateViaUi(page, page.locator("#document-expiresAt"), caracasToday());
  }
  await page.getByRole("button", { name: "Crear documento", exact: true }).click();
  await expect(page.getByText("Documento creado")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/documents/${RECORD_ID}(?:/editor)?(?:[?#].*)?$`));
  return idFromUrl(page, "/documents/");
}
