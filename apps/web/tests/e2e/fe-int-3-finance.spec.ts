import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import { namePrefix } from "./support/accessible-names";
import { createAccountViaUi, createClientViaUi, pickDateViaUi } from "./support/ui-data";

// FE-INT-R E.2 finance E2E (old 3.8 without HU-13; HU-13 is E.3's `fe-int-3-payments.spec.ts`). HU-09 CA1–CA3,
// HU-10 CA1–CA3, HU-11 CA1–CA5, HU-12 CA1–CA3 and CA5, HU-14, HU-15 CA1–CA3, HU-16 CA1–CA2, HU-17 CA1–CA3, HU-28 for
// an invoice, and the in-shell not-found of a Member on `/invoices/list` (rule 31).
//
// Rule 29: every spec creates its own data through the UI with unique names (`E2E finance <stamp>`). The only seed
// records used are the catalogs (the USD currency, the Zelle method, the 40/30/30 template) and the test users. Upload
// calls are intercepted (rule 30): no Cloudinary call is made. Money is asserted as es-VE text from the response.
//
// Every title carries `@authenticated`: the `authenticated` project runs them, with `--workers=1`, as the user does
// with the local BE (DT-204). Nothing here starts the stack.

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** A labelled upload answers with a 200 and no call leaves the test: the storage POST is stubbed (rule 30). */
async function stubStorage(page: Page) {
  await page.route(/cloudinary\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

/** es-VE amounts: "4000,00 US$" below 10 000 and "10.000,00 US$" above; the regex accepts both group forms. */
const money = (digits: string) => new RegExp(`(^|[^\\d.])${digits.replace(".", "\\.?")}`);

/** A name unique to this run, so no spec relies on another spec's records. */
const uniq = (label: string) => `E2E finance ${label} ${Date.now()}`;

/** A RIF-like tax id, unique enough for one run. */
const taxId = () => `J-${Math.floor(10_000_000 + Math.random() * 89_999_999)}-1`;

/** The record id of a route segment, read from the URL after a save redirect (`/projects/<id>`). */
function idFromUrl(url: string, segment: string): string {
  const id = new RegExp(`/${segment}/([^/?#]+)`).exec(url)?.[1];
  if (!id) throw new Error(`No /${segment}/ id in ${url}`);
  return id;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared with the other specs: a client created through /clients/new, its URL checked against a record id (not "new").
function createClient(page: Page, name: string): Promise<string> {
  return createClientViaUi(page, name, taxId());
}

async function createProject(page: Page, clientName: string, name: string): Promise<string> {
  await page.goto("/projects/new");
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Resumen", { exact: true }).fill("Proyecto E2E de finanzas");
  const clients = page.getByRole("combobox", { name: "Clientes", exact: true });
  await clients.fill(clientName);
  await page.getByRole("option", { name: namePrefix(clientName) }).click();
  await page.getByRole("textbox", { name: `Rol: ${clientName}`, exact: true }).fill("Contratante");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}/);
  return idFromUrl(page.url(), "projects");
}

/**
 * An account of this run; the opening balance is entered in the account's currency. Returns its id. The shared helper
 * also fills the required opening date (`#account-opening-date`), which this spec did not, so the save was refused.
 */
async function createAccount(
  page: Page,
  name: string,
  currency: string,
  opening: string,
): Promise<string> {
  return createAccountViaUi(page, { name, currency, openingBalance: opening });
}

/** A client with one project whose billing plan (10 000 USD, 40/30/30 template) is generated. */
async function setupInstallmentClient(page: Page) {
  const clientName = uniq("cliente");
  const projectName = uniq("proyecto");
  const clientId = await createClient(page, clientName);
  const projectId = await createProject(page, clientName, projectName);
  await page.goto(`/projects/${projectId}/billing`);
  await page.locator("#plan-contract").fill("10000");
  await page.getByRole("button", { name: "Crear plan", exact: true }).click();
  await expect(page.getByText("Plan de facturación guardado")).toBeVisible();
  await page.getByRole("button", { name: "Aplicar plantilla", exact: true }).click();
  await expect(page.getByText("Cuotas generadas desde la plantilla")).toBeVisible();
  return { clientId, projectId, projectName };
}

/**
 * Bills the pending installment named `installment` (default: the first pending one) as a draft invoice. The form
 * starts with one blank manual line: the installment line is appended, and the blank line is removed.
 */
async function draftInvoiceFromInstallment(
  page: Page,
  clientId: string,
  number: string,
  installment: string | RegExp = /^Facturar la cuota /,
): Promise<string> {
  await page.goto(`/invoices/new?clientId=${clientId}`);
  await page.getByRole("checkbox", { name: installment }).first().click();
  await page.getByRole("button", { name: "Quitar línea" }).first().click();
  await page.locator("#invoice-number").fill(number);
  // The form issues on save unless "Guardar como borrador" is on.
  const draft = page.getByRole("switch", { name: "Guardar como borrador", exact: true });
  await draft.click();
  await expect(draft).toBeChecked();
  await page.locator('button[type="submit"][form="invoice-form"]').last().click();
  await expect(page.getByText("Factura registrada")).toBeVisible();
  await expect(page).toHaveURL(/\/invoices\/[a-z0-9]{20,}/, { timeout: 30_000 });
  return idFromUrl(page.url(), "invoices");
}

async function issueInvoice(page: Page, invoiceId: string) {
  await page.goto(`/invoices/${invoiceId}`);
  await page.getByRole("button", { name: "Emitir", exact: true }).click();
  await expect(page.getByText("Borrador emitido")).toBeVisible();
}

// ───────────────────────────── HU-09 · plan with a template ─────────────────────────────

test.describe("FE-INT-R E.2 finance", () => {
  test.beforeAll(async () => {
    await assertBackendHealthy();
  });
  // Each case builds its client, project, plan and installments through the UI first: 30 s is too tight.
  test.slow();

  test("@authenticated HU-09 CA1/CA2: 40/30/30 over 10 000 USD gives 4 000, 3 000, 3 000; a mismatch shows a persistent warning", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const { projectId } = await setupInstallmentClient(page);

    await page.goto(`/projects/${projectId}/billing`);
    const table = page.getByRole("table").first();
    await expect(table.getByText(money("4.000,00"))).toHaveCount(1);
    await expect(table.getByText(money("3.000,00"))).toHaveCount(2);
    await expect(page.getByText("Las cuotas no suman el monto contratado")).toHaveCount(0);

    // CA2: the contract changes to 11 000 → the non-AJUSTE installments differ by 1 000: warning, saved anyway.
    await page.locator("#plan-contract").fill("11000");
    await page.getByRole("button", { name: "Guardar plan", exact: true }).click();
    await expect(page.getByText("Plan de facturación guardado")).toBeVisible();
    await expect(page.getByText("Las cuotas no suman el monto contratado")).toBeVisible();
    await page.goto(`/projects/${projectId}/billing`);
    await expect(page.getByText("Las cuotas no suman el monto contratado")).toBeVisible();
  });

  // ───────────────────────────── HU-10 · recurring charge ─────────────────────────────

  test("@authenticated HU-10 CA1/CA2/CA3: a monthly charge generates its periods once; a paused charge generates none", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const { projectId } = await setupInstallmentClient(page);
    const chargeName = uniq("mantenimiento");

    // The start is two months back, so the periods due before today exist; billing day 5, 7 days of lead time.
    const start = new Date();
    start.setMonth(start.getMonth() - 2, 1);
    const startDate = start.toISOString().slice(0, 10);

    await page.goto(`/projects/${projectId}/billing`);
    await page.getByRole("button", { name: "Nuevo cobro recurrente", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre", { exact: true }).fill(chargeName);
    await dialog.getByLabel("Monto por periodo", { exact: true }).fill("100");
    await pickDateViaUi(page, dialog.getByLabel("Inicio", { exact: true }), startDate);
    await dialog.getByLabel("Día de cobro", { exact: true }).fill("5");
    await dialog.getByLabel("Días de anticipación", { exact: true }).fill("7");
    await dialog.getByRole("button", { name: "Crear cobro", exact: true }).click();
    await expect(page.getByText("Cobro recurrente creado")).toBeVisible();

    // CA1: the periods are generated with their billing day (the 5th). The PRD's "28 or 29 of the month before" is the
    // day the daily job creates the period (`generateOn = periodStart − leadDays`), which the UI does not show; the BE
    // covers it in `apps/api/src/modules/finance/domain/recurring.test.ts`.
    const generate = page.getByRole("button", {
      name: `Generar periodos pendientes de ${chargeName}`,
    });
    await generate.click();
    await expect(page.getByText(/periodos? generados?/)).toBeVisible();
    await expect(page.getByText(/(^|\D)0?5 [a-zé]{3,4}\.? \d{4}/).first()).toBeVisible();

    // CA2: running the task again the same day does not duplicate the installments.
    await generate.click();
    await expect(page.getByText("No había periodos pendientes por generar")).toBeVisible();

    // CA3: a paused charge generates no installments.
    const pausedName = uniq("pausado");
    await page.getByRole("button", { name: "Nuevo cobro recurrente", exact: true }).click();
    const second = page.getByRole("dialog");
    await second.getByLabel("Nombre", { exact: true }).fill(pausedName);
    await second.getByLabel("Monto por periodo", { exact: true }).fill("50");
    await pickDateViaUi(page, second.getByLabel("Inicio", { exact: true }), startDate);
    await second.getByLabel("Día de cobro", { exact: true }).fill("5");
    await second.getByLabel("Días de anticipación", { exact: true }).fill("7");
    await second.getByRole("button", { name: "Crear cobro", exact: true }).click();
    await expect(page.getByText("Cobro recurrente creado")).toBeVisible();
    await page.getByRole("button", { name: `Pausar ${pausedName}` }).click();
    await expect(page.getByText("Cobro pausado: no genera cuotas")).toBeVisible();
    await page
      .getByRole("button", { name: `Generar periodos pendientes de ${pausedName}` })
      .click();
    await expect(page.getByText("No había periodos pendientes por generar")).toBeVisible();
  });

  // ───────────────────────────── HU-09 CA3 + HU-11 · invoice from installments ─────────────────────────────

  test("@authenticated HU-11 CA1/CA2/CA5 + HU-09 CA3: billing a pending installment creates its line, live totals, FACTURADA and locked", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const { clientId, projectId } = await setupInstallmentClient(page);

    // CA1: the client's pending installments are offered; the selection creates the line.
    await page.goto(`/invoices/new?clientId=${clientId}`);
    const checkbox = page.getByRole("checkbox", { name: "Facturar la cuota Cuota 1", exact: true });
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(page.locator("#line-1-description")).toHaveValue(/^Cuota 1$/);
    await expect(page.locator("#line-1-price")).toHaveValue(/^4000(\.00)?$/);
    await page.getByRole("button", { name: "Quitar línea" }).first().click();
    await expect(page.locator("#line-0-description")).toHaveValue(/^Cuota 1$/);
    // CA2: live totals, 4 000 at the default 16 % → total 4 640.
    await expect(page.getByText(money("4.640,00")).first()).toBeVisible();

    await page.locator("#invoice-number").fill(uniq("factura").replace(/\s/g, "-"));
    await page.locator('button[type="submit"][form="invoice-form"]').last().click();
    await expect(page.getByText("Factura registrada")).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/[a-z0-9]{20,}/, { timeout: 30_000 });

    // CA5: the installment is FACTURADA and no longer offered.
    await page.goto(`/invoices/new?clientId=${clientId}`);
    await expect(
      page.getByRole("checkbox", { name: "Facturar la cuota Cuota 1", exact: true }),
    ).toHaveCount(0);
    await page.goto(`/projects/${projectId}/billing`);
    const row = page.getByRole("row", { name: /Cuota 1\b/ });
    await expect(row.getByText("Facturada").first()).toBeVisible();

    // HU-09 CA3: a billed installment keeps its amount and currency; only the label is editable.
    await row.getByRole("button", { name: "Editar Cuota 1", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Cuota facturada: solo se puede cambiar la etiqueta."),
    ).toBeVisible();
    await expect(dialog.getByLabel("Monto", { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel("Nombre", { exact: true })).toBeEnabled();
  });

  // ───────────────────────────── HU-11 CA3/CA4 · number and PDF ─────────────────────────────

  test("@authenticated HU-11 CA3: the invoice number is unique among the active invoices", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const { clientId } = await setupInstallmentClient(page);
    const number = uniq("num").replace(/\s/g, "-");
    await draftInvoiceFromInstallment(page, clientId, number);

    // CA3: a second active invoice with the same number is refused by the BE (`numberTaken`).
    await page.goto(`/invoices/new?clientId=${clientId}`);
    await page
      .getByRole("checkbox", { name: /^Facturar la cuota / })
      .first()
      .click();
    await page.getByRole("button", { name: "Quitar línea" }).first().click();
    await page.locator("#invoice-number").fill(number);
    await page.locator('button[type="submit"][form="invoice-form"]').last().click();
    await expect(
      page
        .getByRole("group", { name: "Datos de la factura" })
        .getByRole("alert")
        .filter({ hasText: "Ya existe una factura con este número" }),
    ).toBeVisible();
  });

  // The BE confirms an upload by reading the object on Cloudinary from the server, which a browser-side stub cannot
  // answer (`confirm-upload.use-case.ts`, `getObjectInfo`): uploads are a live third-party case (rule 30).
  test.fixme("@authenticated HU-11 CA4: the real PDF attaches and shows on the detail — FE-INT-R: the BE verifies the upload on Cloudinary server-side (live third-party service); the batch-close manual check covers it", async () => {});

  // ───────────────────────────── HU-12 · automatic status and void ─────────────────────────────

  test("@authenticated HU-12 CA1–CA3, CA5: an issued invoice is EMITIDA, PARCIAL after a partial payment, PAGADA when settled; void needs a reason and no allocations", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const account = uniq("cuenta");
    await createAccount(page, account, "USD", "0");

    const { clientId } = await setupInstallmentClient(page);
    const invoiceId = await draftInvoiceFromInstallment(
      page,
      clientId,
      uniq("n").replace(/\s/g, "-"),
    );
    await issueInvoice(page, invoiceId);

    // CA1: no payment and not due → EMITIDA.
    await expect(page.getByText(/^Emitida$/).first()).toBeVisible();

    // CA2: a confirmed payment below the balance → PARCIAL. IGTF is set to 0 after the amount so the allocation
    // equals the amount (the IGTF proposal is recalculated when the amount changes).
    await payInvoice(page, invoiceId, account, "100", "0", "100");
    await page.goto(`/invoices/${invoiceId}`);
    await expect(page.getByText(/^Parcial$/).first()).toBeVisible();

    // CA3: the rest settles the balance (4 640 − 100) → PAGADA.
    await payInvoice(page, invoiceId, account, "4540", "0", "4540");
    await page.goto(`/invoices/${invoiceId}`);
    await expect(page.getByText(/^Pagada$/).first()).toBeVisible();

    // CA5: void on a fresh invoice needs a reason; the allocated invoice refuses the void.
    const voidable = await draftInvoiceFromInstallment(
      page,
      clientId,
      uniq("v").replace(/\s/g, "-"),
      /^Facturar la cuota /,
    );
    await issueInvoice(page, voidable);
    await page.goto(`/invoices/${voidable}`);
    await page.getByRole("button", { name: "Anular", exact: true }).first().click();
    const voidDialog = page.getByRole("dialog");
    await voidDialog.getByRole("button", { name: "Anular factura", exact: true }).click();
    await expect(page.getByText("Factura anulada")).toHaveCount(0);
    await voidDialog.getByLabel("Motivo", { exact: true }).fill("E2E: anulación de prueba");
    await voidDialog.getByRole("button", { name: "Anular factura", exact: true }).click();
    await expect(page.getByText("Factura anulada")).toBeVisible();

    await page.goto(`/invoices/${invoiceId}`);
    await page.getByRole("button", { name: "Anular", exact: true }).first().click();
    await page
      .getByRole("dialog")
      .getByLabel("Motivo", { exact: true })
      .fill("E2E: no debe anularse");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Anular factura", exact: true })
      .click();
    await expect(
      page.getByText("La factura tiene pagos asignados: quita primero esas asignaciones"),
    ).toBeVisible();
  });

  // ───────────────────────────── HU-14 · receipt ─────────────────────────────

  // Same reason as HU-11 CA4: the BE confirms the receipt on Cloudinary server-side (rule 30).
  test.fixme("@authenticated HU-14: a receipt uploaded through the intercepted storage POST is shown on the payment detail — FE-INT-R: the BE verifies the upload on Cloudinary server-side (live third-party service); the batch-close manual check covers it", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    await stubStorage(page);
    const account = uniq("cuenta-comprobante");
    await createAccount(page, account, "USD", "0");

    // The payment is created only as the receipt's carrier: an allocation to an issued invoice (HU-13 is E.3's).
    const { clientId } = await setupInstallmentClient(page);
    const invoiceId = await draftInvoiceFromInstallment(
      page,
      clientId,
      uniq("c").replace(/\s/g, "-"),
    );
    await issueInvoice(page, invoiceId);

    await page.goto(`/payments/new?invoiceId=${invoiceId}`);
    await page.locator("#payment-account").click();
    await page
      .getByRole("option", { name: new RegExp(`^${escapeRegExp(account)} \\(USD\\)$`) })
      .click();
    await page.locator("#payment-method").click();
    await page.getByRole("option", { name: /^Zelle$/ }).click();
    await page.locator("#payment-amount").fill("10");
    await page.locator("#payment-igtf").fill("0");
    await page.locator("#payment-reference").fill(uniq("ref").replace(/\s/g, "-"));
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "comprobante.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
    await expect(page.getByText("Pago registrado")).toBeVisible();
    await expect(page).toHaveURL(/\/payments\/[a-z0-9]{20,}/);

    // CA2: the receipt is visible on the detail without a download.
    await expect(page.getByText("Comprobante", { exact: true }).first()).toBeVisible();
    await expect(page.locator('img[src*="/files/"], iframe[src*="/files/"]').first()).toBeVisible();
  });

  // ───────────────────────────── HU-28 · archive, trash, restore ─────────────────────────────

  test("@authenticated HU-28 invoice: archive → trash → restore; a restore is refused with CONFLICT while another active invoice has the number", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const { clientId } = await setupInstallmentClient(page);
    const number = uniq("arch").replace(/\s/g, "-");
    const archivedId = await draftInvoiceFromInstallment(page, clientId, number);

    // Archiving moves the invoice to the trash (HU-28 CA1): the invoice "Archivar" acts at once (no confirmation
    // dialog) and returns to the list.
    await page.goto(`/invoices/${archivedId}`);
    await page.getByRole("button", { name: "Archivar", exact: true }).click();
    await expect(page.getByText("Factura archivada")).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/list/);

    // The number is free again among the non-archived invoices (HU-11 CA3): a new invoice takes it.
    await draftInvoiceFromInstallment(page, clientId, number);

    // CA2: restoring the archived one now conflicts with the active invoice holding the number.
    await page.goto("/settings/trash");
    await page.getByPlaceholder("Buscar registros archivados…").fill(number);
    const row = page.getByRole("row").filter({ hasText: number });
    await row.getByRole("button", { name: /^Restaurar/ }).click();
    await expect(
      page.getByText("Otra factura activa ya usa este número. Edítala antes de restaurar esta."),
    ).toBeVisible();
    await expect(
      row.getByRole("link", { name: /^Abrir / }).or(row.getByRole("button", { name: /^Abrir / })),
    ).toBeVisible();
  });

  // ───────────────────────────── HU-15 · balances, book and reconciliation ─────────────────────────────

  test("@authenticated HU-15 CA1–CA3: a balance is its opening plus its movements; the book shows the running balance; a reconciliation difference suggests an adjustment", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const account = uniq("cuenta-saldo");
    const accountId = await createAccount(page, account, "USD", "1000");

    // CA1: opening 1 000 + a contribution of 250 → 1 250.
    await page.goto("/accounts/movements/new");
    await page.locator("#movement-account").click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(account)}`) }).click();
    await page.locator("#movement-amount").fill("250");
    // A capital contribution names its partner and a description.
    await page.locator("#movement-partner").click();
    await page.getByRole("option").first().click();
    await page.locator("#movement-description").fill(uniq("aporte"));
    await page.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
    await expect(page.getByText("Movimiento registrado")).toBeVisible();

    await page.goto(`/accounts/${accountId}`);
    await expect(page.getByText(money("1.250,00")).first()).toBeVisible();

    // CA2: the book lists each movement with the running balance after it.
    await expect(page.getByText("Libro de movimientos")).toBeVisible();
    await expect(page.getByRole("table").getByText(money("1.250,00")).first()).toBeVisible();

    // CA3: a statement of 1 200 against a system balance of 1 250 differs by 50 → an adjustment is suggested.
    await page.getByLabel("Saldo del estado de cuenta", { exact: true }).fill("1200");
    await page.getByRole("button", { name: "Conciliar", exact: true }).click();
    await expect(page.getByText("La diferencia sugiere un ajuste por ese importe.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Registrar ajuste", exact: true })).toBeVisible();
  });

  // ───────────────────────────── HU-16 · transfer between currencies ─────────────────────────────

  test("@authenticated HU-16 CA1/CA2: 100 USD sent from Zelle receives 99 USDT: the origin loses 100 and the target gains 99; a transfer to the same account is refused", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const origin = uniq("zelle-usd");
    const target = uniq("binance-usdt");
    await createAccount(page, origin, "USD", "500");
    await createAccount(page, target, "USDT", "0");

    await page.goto("/accounts/transfers/new");
    await page.locator("#transfer-from").click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(origin)}`) }).click();
    await page.locator("#transfer-to").click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(target)}`) }).click();
    await page.locator("#transfer-amount-from").fill("100");
    await page.locator("#transfer-amount-to").fill("99");
    await page.locator("#transfer-fee").fill("0");
    // Different currencies need the cross rate: what arrives divided by what leaves (99 / 100).
    await page.locator("#transfer-rate").fill("0.99");
    await page.getByRole("button", { name: "Registrar transferencia", exact: true }).click();
    await expect(page.getByText("Transferencia registrada")).toBeVisible();

    // The list pages at 25 rows and E2E accounts accumulate: search each account before reading its row.
    await page.goto("/accounts/list");
    const search = page.getByRole("searchbox", { name: "Buscar en la tabla" });
    await search.fill(origin);
    await expect(
      page.getByRole("row").filter({ hasText: origin }).getByText(money("400,00")),
    ).toBeVisible();
    await search.fill(target);
    await expect(
      page.getByRole("row").filter({ hasText: target }).getByText(money("99,00")),
    ).toBeVisible();

    // CA2: the same account on both sides is refused by the form.
    await page.goto("/accounts/transfers/new");
    await page.locator("#transfer-from").click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(origin)}`) }).click();
    await page.locator("#transfer-to").click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(origin)}`) }).click();
    await page.locator("#transfer-amount-from").fill("10");
    await page.locator("#transfer-amount-to").fill("10");
    await page.getByRole("button", { name: "Registrar transferencia", exact: true }).click();
    await expect(
      page.getByText("La cuenta de origen y la de destino deben ser distintas"),
    ).toBeVisible();
  });

  // ───────────────────────────── HU-17 · expenses ─────────────────────────────

  test.fixme("@authenticated HU-17 CA1: an active monthly subscription generates one PENDIENTE expense per period, no duplicates — FE-INT-R E.2: the periods come from the BE daily task (no UI trigger); the batch-close manual check covers the next run", async () => {});

  test("@authenticated HU-17 CA2/CA3: marking a pending expense as paid requires its account, and the paid expense shows in the project's billing summary", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const account = uniq("cuenta-gasto");
    await createAccount(page, account, "USD", "1000");
    const { projectId, projectName } = await setupInstallmentClient(page);

    await page.goto("/expenses/new");
    await page.locator("#expense-description").fill(uniq("suscripción"));
    await page.locator("#expense-category").click();
    await page.getByRole("option").first().click();
    await page.locator("#expense-project").click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(projectName)}`) }).click();
    await page.locator("#expense-status").click();
    await page.getByRole("option", { name: /^Pendiente$/ }).click();
    await page.locator("#expense-amount").fill("137");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Gasto registrado")).toBeVisible();
    await expect(page).toHaveURL(/\/expenses\/[^/]+$/);

    // CA2: "Marcar como pagado" refuses a missing account, then accepts the account and the real debit amount.
    await page.getByRole("button", { name: "Marcar como pagado", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Marcar como pagado", exact: true }).click();
    // The mark-paid dialog validates the account as a required id ("Campo obligatorio").
    await expect(dialog.getByRole("alert").filter({ hasText: "Campo obligatorio" })).toBeVisible();
    await dialog.locator("#mark-paid-account").click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(account)}`) }).click();
    await dialog.locator("#mark-paid-account-amount").fill("137");
    await dialog.getByRole("button", { name: "Marcar como pagado", exact: true }).click();
    await expect(page.getByText("Gasto marcado como pagado")).toBeVisible();

    // CA3: a paid expense on a project reduces that project's margin (its paid expenses appear in the summary).
    await page.goto(`/projects/${projectId}/billing`);
    await expect(page.getByText("Gastos pagados").first()).toBeVisible();
    await expect(page.getByText(money("137,00")).first()).toBeVisible();
  });

  // ───────────────────────────── Role · Member ─────────────────────────────

  test("@authenticated HU-11 (rule 31): a Member opening /invoices/list gets the in-shell not-found page and no new-invoice action", async ({
    page,
  }) => {
    await signInAs(page, "MEMBER");
    await page.goto("/invoices/list");
    await expect(page.getByText(/^(Página no encontrada|Page not found)$/)).toBeVisible();
    await expect(page.getByRole("link", { name: /^(Nueva factura|New invoice)$/ })).toHaveCount(0);
  });
});

/** Registers a payment of `amount` from `account` (USD) allocated to `invoiceId`; IGTF is forced to `igtf`. */
async function payInvoice(
  page: Page,
  invoiceId: string,
  account: string,
  amount: string,
  igtf: string,
  allocation: string,
) {
  await page.goto(`/payments/new?invoiceId=${invoiceId}`);
  await page.locator("#payment-account").click();
  await page
    .getByRole("option", { name: new RegExp(`^${escapeRegExp(account)} \\(USD\\)$`) })
    .click();
  await page.locator("#payment-method").click();
  await page.getByRole("option", { name: /^Zelle$/ }).click();
  await page.locator("#payment-amount").fill(amount);
  await page.locator("#payment-igtf").fill(igtf);
  await page.locator(`#payment-alloc-${invoiceId}`).fill(allocation);
  await page.locator("#payment-reference").fill(uniq("ref").replace(/\s/g, "-"));
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(page.getByText("Pago registrado")).toBeVisible();
}
