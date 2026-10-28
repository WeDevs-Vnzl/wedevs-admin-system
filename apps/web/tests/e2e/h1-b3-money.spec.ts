import { expect, test, type Page } from "@playwright/test";

// T10 phase B E2E regression tests, H1-B3 money flows (odd/tasks/h1-b3-finance-ui.md S3, S5, S7). This file starts nothing:
// it runs against PLAYWRIGHT_BASE_URL (safeguards.md rule 1). The mock store is one in-memory object per server
// process, so run it with `--workers=1`; every test resets the mock data first. Default role: Owner.
// Seed facts: `pry_solaris_portal` (client `cli_solaris_energia`) has no billing plan; `cli_kairos` has the
// pending 40/30/30 installments of `pry_kairos_web` ("Anticipo 40 %" 4 000 USD …); `inv_kairos_partial` is an
// open USD invoice of Kairos.

async function resetMockData(page: Page) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
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

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function pick(page: Page, triggerId: string, option: string | RegExp) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option }).click();
}

// es-VE: "4000,00 US$" (no group separator below five digits), "10.000,00 US$".
const money = (digits: string) => new RegExp(`(^|[^\\d.])${digits.replace(".", "\\.?")}`);

test.beforeEach(async ({ page }) => {
  await resetMockData(page);
});

test("HU-09 CA1/CA2: 40/30/30 over 10 000 USD gives 4 000, 3 000, 3 000; a mismatch shows a persistent warning", async ({
  page,
}) => {
  await open(page, "/projects/pry_solaris_portal/billing");
  await page.locator("#plan-contract").fill("10000");
  await page.getByRole("button", { name: "Crear plan", exact: true }).click();
  await expect(page.getByText("Plan de facturación guardado")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Aplicar plantilla", exact: true }).click();
  await expect(page.getByText("Cuotas generadas desde la plantilla")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const table = page.getByRole("table").first();
  await expect(table.getByText(money("4.000,00"))).toHaveCount(1);
  await expect(table.getByText(money("3.000,00"))).toHaveCount(2);
  await expect(page.getByText("Las cuotas no suman el monto contratado")).toHaveCount(0);

  // CA2: the contract changes to 11 000 → the non-AJUSTE installments differ by 1 000: warning, saved anyway.
  await page.locator("#plan-contract").fill("11000");
  await page.getByRole("button", { name: "Guardar plan", exact: true }).click();
  await expect(page.getByText("Plan de facturación guardado")).toBeVisible();
  await expect(page.getByText("Las cuotas no suman el monto contratado")).toBeVisible();
  await open(page, "/projects/pry_solaris_portal/billing");
  await expect(page.getByText("Las cuotas no suman el monto contratado")).toBeVisible();
});

test("HU-11 CA1/CA2/CA5 + HU-09 CA3: billing a pending installment creates its line, live totals, FACTURADA and locked", async ({
  page,
}) => {
  await open(page, "/invoices/new?clientId=cli_kairos");
  const checkbox = page.getByRole("checkbox", { name: "Facturar la cuota Anticipo 40 %" });
  await expect(checkbox).toBeVisible();
  await checkbox.click();
  // The form starts with one blank manual line; the installment line is appended after it.
  await expect(page.locator("#line-1-description")).toHaveValue(/Anticipo 40 %/);
  await expect(page.locator("#line-1-price")).toHaveValue(/^4000(\.00)?$/);
  await page.getByRole("button", { name: "Quitar línea" }).first().click();
  await expect(page.locator("#line-0-description")).toHaveValue(/Anticipo 40 %/);
  // CA2: live totals, 4 000 at the default 16 % → total 4 640.
  await expect(page.getByText(money("4.640,00")).first()).toBeVisible();

  await page.locator("#invoice-number").fill("E2E-HU11-1");
  await page.locator('button[type="submit"][form="invoice-form"]').last().click();
  await expect(page.getByText("Factura registrada")).toBeVisible();
  // The detail route may compile on first visit in dev.
  await expect(page).toHaveURL(/\/invoices\/inv_/, { timeout: 30_000 });

  // CA5: the installment is FACTURADA and no longer offered.
  await open(page, "/invoices/new?clientId=cli_kairos");
  await expect(page.getByRole("checkbox", { name: "Facturar la cuota Anticipo 40 %" })).toHaveCount(
    0,
  );
  await open(page, "/projects/pry_kairos_web/billing");
  const row = page.getByRole("row", { name: /Anticipo 40 %/ });
  await expect(row.getByText("Facturada").first()).toBeVisible();

  // HU-09 CA3: a billed installment keeps its amount and currency (only the label is editable).
  await row.getByRole("button", { name: /Editar Anticipo 40 %/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Cuota facturada: solo se puede cambiar la etiqueta."),
  ).toBeVisible();
  await expect(dialog.getByLabel("Monto", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Nombre", { exact: true })).toBeEnabled();
});

test("HU-13 CA2/CA3/CA5/CA6: 100 USD with IGTF 3 → allocatable 97, net 100; allocation capped; duplicate warning", async ({
  page,
}) => {
  await open(page, "/payments/new?invoiceId=inv_kairos_partial");
  await pick(page, "payment-account", /^Zelle USD \(USD\)$/);
  await pick(page, "payment-method", /^Zelle$/);
  await page.locator("#payment-amount").fill("100");
  await expect(page.locator("#payment-igtf")).toHaveValue(/^3(\.00)?$/);
  const amounts = page.locator("dl").filter({ hasText: "Monto asignable" });
  await expect(amounts.getByText(money("97,00"))).toBeVisible();
  await expect(amounts.getByText(money("100,00"))).toBeVisible();

  // CA3: an allocation over the allocatable amount is refused.
  const allocation = page.locator("#payment-alloc-inv_kairos_partial");
  await expect(allocation).toBeEnabled(); // ?invoiceId= ticks the invoice
  await allocation.fill("98");
  await page.locator("#payment-reference").fill("E2E-HU13-REF");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(page).toHaveURL(/\/payments\/new/);

  // A valid allocation of 60 leaves 37 as credit (CA5).
  await allocation.fill("60");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(page.getByText("Pago registrado")).toBeVisible();
  await expect(page).toHaveURL(/\/payments\/pag_/);
  await expect(page.getByText(money("37,00")).first()).toBeVisible();

  // CA6: same reference, method and account → possible duplicate warning.
  await open(page, "/payments/new?invoiceId=inv_kairos_partial");
  await pick(page, "payment-account", /^Zelle USD \(USD\)$/);
  await pick(page, "payment-method", /^Zelle$/);
  await page.locator("#payment-amount").fill("10");
  await page.locator("#payment-reference").fill("E2E-HU13-REF");
  await page.locator("#payment-reference").blur();
  await expect(page.getByText("Posible duplicado")).toBeVisible();
});
