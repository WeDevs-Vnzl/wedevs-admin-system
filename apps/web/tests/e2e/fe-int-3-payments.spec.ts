import { expect, test, type Browser, type Page } from "@playwright/test";
import { appBaseUrl } from "./support/app";
import { namePrefix } from "./support/accessible-names";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import {
  createAccountViaUi,
  createClientViaUi,
  createInvoiceViaUi,
  loadRateViaUi,
  openPage,
} from "./support/ui-data";

// FE-INT-R E.3 payments E2E (HU-13 CA1–CA6, the payment edit route and the status commands, DT-213, DT-220).
// Runs in the `authenticated` project against the local BE (safeguards.md rule 1); nothing here starts a server. The
// Owner signs in through the Clerk test user (DT-204). Every record is created through the UI with a unique name
// (W5 rule 29): one client, one USD account and one VES account plus today's BCV rate are created once per run, and
// each test creates its own invoices and payments, so no test depends on another one's records.
// Copy is Spanish (the Owner's default locale); amounts use the es-VE format ("97,00").
//
// A payment created from the form is always CONFIRMADO. The "Confirmar pago" command applies to a
// PENDIENTE_VERIFICACION payment, which only the Stripe/Binance webhooks create (DT-183), so that case is a
// `test.fixme` covered by the BE e2e and the batch-close manual check (W5 rule 30).

const RUN = Date.now();

interface Fixture {
  clientName: string;
  clientId: string;
  usdAccount: string;
  vesAccount: string;
}

let fixture: Fixture;

// es-VE: "97,00" (no group separator below five digits).
const money = (digits: string) => new RegExp(`(^|[^\\d.])${digits.replace(".", "\\.?")}`);

async function arrange(browser: Browser): Promise<Fixture> {
  const context = await browser.newContext({ baseURL: appBaseUrl() });
  const page = await context.newPage();
  try {
    await signInAs(page, "OWNER");
    const clientName = `E2E pagos ${RUN}`;
    const clientId = await createClientViaUi(page, clientName, `E2E-PAY-${RUN}`);
    const usdAccount = `E2E Zelle USD ${RUN}`;
    const vesAccount = `E2E Banco VES ${RUN}`;
    await createAccountViaUi(page, { name: usdAccount, currency: "USD" });
    await createAccountViaUi(page, { name: vesAccount, currency: "VES", type: "Banco nacional" });
    await loadRateViaUi(page, "VES", "36.50");
    return { clientName, clientId, usdAccount, vesAccount };
  } finally {
    await context.close();
  }
}

/** A USD invoice of the fixture client; at 16 % IVA a price of 100 gives a balance of 116. */
async function newInvoice(page: Page, tag: string, price = "100") {
  return createInvoiceViaUi(page, {
    clientName: fixture.clientName,
    invoiceNumber: `E2E-PAY-${tag}-${Date.now()}`,
    price,
  });
}

async function pickClient(page: Page) {
  await page.locator("#payment-client").fill(fixture.clientName);
  await page.getByRole("option", { name: namePrefix(fixture.clientName) }).click();
}

async function pickAccountAndMethod(page: Page, account: string, currency: string, method: string) {
  await page.locator("#payment-account").click();
  await page.getByRole("option", { name: `${account} (${currency})`, exact: true }).click();
  await page.locator("#payment-method").click();
  await page.getByRole("option", { name: method, exact: true }).click();
}

const submit = (page: Page) => page.getByRole("button", { name: "Registrar pago", exact: true });

/** Registers a USD Zelle payment of `amount` for the fixture client, optionally applied to one invoice. */
async function registerUsdPayment(
  page: Page,
  options: { amount: string; reference: string; invoiceId?: string; allocation?: string },
): Promise<string> {
  await openPage(
    page,
    options.invoiceId ? `/payments/new?invoiceId=${options.invoiceId}` : "/payments/new",
  );
  if (!options.invoiceId) await pickClient(page);
  await pickAccountAndMethod(page, fixture.usdAccount, "USD", "Zelle");
  await page.locator("#payment-amount").fill(options.amount);
  await page.locator("#payment-reference").fill(options.reference);
  if (options.invoiceId && options.allocation) {
    await page.locator(`#payment-alloc-${options.invoiceId}`).fill(options.allocation);
  }
  await submit(page).click();
  await expect(page.getByText("Pago registrado")).toBeVisible();
  await expect(page).toHaveURL(/\/payments\/[a-z0-9]{20,}$/);
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

test.describe("FE-INT-3 payments", () => {
  test.beforeAll(async ({ browser }) => {
    await assertBackendHealthy();
    fixture = await arrange(browser);
  });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated HU-13 CA1: the form asks for its required fields and the reference of a method that needs it", async ({
    page,
  }) => {
    await openPage(page, "/payments/new");
    await submit(page).click();
    await expect(page).toHaveURL(/\/payments\/new$/);
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();

    await pickClient(page);
    await pickAccountAndMethod(page, fixture.usdAccount, "USD", "Zelle");
    await page.locator("#payment-amount").fill("10");
    await expect(page.getByText("Este método exige la referencia de la operación.")).toBeVisible();
    await submit(page).click();
    await expect(
      page.getByText("La referencia es obligatoria para este método de pago"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/payments\/new$/);
  });

  test("@authenticated HU-13 CA2/CA3/CA5/CA6: 100 USD with IGTF 3 → allocatable 97, net 100; over-allocation refused; credit 37; duplicate warning", async ({
    page,
  }) => {
    const invoice = await newInvoice(page, "CA2");
    const reference = `E2E-HU13-${Date.now()}`;

    await openPage(page, `/payments/new?invoiceId=${invoice.id}`);
    await pickAccountAndMethod(page, fixture.usdAccount, "USD", "Zelle");
    await page.locator("#payment-amount").fill("100");
    await expect(page.locator("#payment-igtf")).toHaveValue(/^3(\.00)?$/);
    await expect(page.locator("#payment-fee")).toHaveValue(/^0(\.00)?$/);
    const amounts = page.locator("dl").filter({ hasText: "Monto asignable" });
    await expect(amounts.getByText(money("97,00"))).toBeVisible();
    await expect(amounts.getByText(money("100,00"))).toBeVisible();

    // CA3: an allocation over the allocatable amount is refused, at the allocations of the form.
    const allocation = page.locator(`#payment-alloc-${invoice.id}`);
    await expect(allocation).toBeEnabled(); // ?invoiceId= ticks the invoice
    await allocation.fill("98");
    await page.locator("#payment-reference").fill(reference);
    await submit(page).click();
    await expect(page.getByText("Las asignaciones superan el monto asignable")).toBeVisible();
    await expect(page).toHaveURL(/\/payments\/new/);

    // A valid allocation of 60 leaves 37 as credit (CA5), in the payment and in the client.
    await allocation.fill("60");
    await submit(page).click();
    await expect(page.getByText("Pago registrado")).toBeVisible();
    await expect(page).toHaveURL(/\/payments\/[a-z0-9]{20,}$/);
    await expect(page.getByText(money("37,00")).first()).toBeVisible();
    const code = (await page.getByRole("heading", { level: 1 }).innerText()).trim();

    await openPage(page, `/clients/${fixture.clientId}?tab=payments`);
    await expect(page.getByText("Saldo a favor", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(code) }).first()).toBeVisible();

    // CA6: the same reference, method and account → possible duplicate warning (saving stays possible).
    await openPage(page, "/payments/new");
    await pickClient(page);
    await pickAccountAndMethod(page, fixture.usdAccount, "USD", "Zelle");
    await page.locator("#payment-amount").fill("10");
    await page.locator("#payment-reference").fill(reference);
    await page.locator("#payment-reference").blur();
    await expect(page.getByText("Posible duplicado")).toBeVisible();
    await expect(submit(page)).toBeEnabled();
  });

  test("@authenticated HU-13 CA4: a VES payment to a USD invoice proposes the USD amount with the day's rate and saves the edited value", async ({
    page,
  }) => {
    const invoice = await newInvoice(page, "CA4");
    await openPage(page, `/payments/new?invoiceId=${invoice.id}`);
    await pickAccountAndMethod(page, fixture.vesAccount, "VES", "Transferencia nacional");
    // The rate of the payment date is looked up (the BCV rate loaded by this spec) and prefilled.
    await expect(page.locator("#payment-usd-rate")).toHaveValue(/^36[.,]5/);
    await page.locator("#payment-amount").fill("1825");
    await page.locator("#payment-reference").fill(`E2E-HU13-VES-${Date.now()}`);

    // 1825 VES at 36.50 → 50 USD proposed; the user edits it and the edited value is the one saved.
    await page.locator(`#payment-alloc-${invoice.id}`).fill("1825");
    const invoiceAmount = page.locator(`#payment-alloc-inv-${invoice.id}`);
    await expect(invoiceAmount).toHaveValue(/^50(\.00)?$/);
    await invoiceAmount.fill("49.50");
    await submit(page).click();
    await expect(page.getByText("Pago registrado")).toBeVisible();
    await expect(page).toHaveURL(/\/payments\/[a-z0-9]{20,}$/);

    const allocations = page.getByRole("table").filter({ hasText: invoice.invoiceNumber });
    await expect(allocations.getByText(money("49,50")).first()).toBeVisible();
  });

  test("@authenticated HU-13: a payment is allocated later and deallocated", async ({ page }) => {
    const invoice = await newInvoice(page, "ALLOC");
    await registerUsdPayment(page, { amount: "100", reference: `E2E-ALLOC-${Date.now()}` });
    await expect(page.getByText("Este pago no está asignado a ninguna factura.")).toBeVisible();

    await page.getByRole("button", { name: "Asignar", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Asignar a facturas" });
    const row = sheet.locator('[data-slot="allocation-row"]').filter({
      hasText: invoice.invoiceNumber,
    });
    await expect(row).toBeVisible();
    await row.getByRole("checkbox").click();
    await row.locator(`#sheet-alloc-${invoice.id}`).fill("50");
    await sheet.getByRole("button", { name: "Asignar", exact: true }).click();
    await expect(page.getByText("Pago asignado")).toBeVisible();
    const allocations = page.getByRole("table").filter({ hasText: invoice.invoiceNumber });
    await expect(allocations).toBeVisible();

    await allocations.getByRole("button", { name: "Desasignar", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Desasignar factura", exact: true })
      .click();
    await expect(page.getByText("Asignación quitada")).toBeVisible();
    await expect(page.getByText("Este pago no está asignado a ninguna factura.")).toBeVisible();
  });

  test.fixme("FE-INT-R E.3: confirming a payment needs a PENDIENTE_VERIFICACION payment, which only the Stripe/Binance webhooks create (live third-party service); covered by the BE e2e and the batch-close manual check", async () => {});

  test("@authenticated HU-13: voiding asks for a reason; the voided payment's edit route goes back to its detail", async ({
    page,
  }) => {
    const paymentId = await registerUsdPayment(page, {
      amount: "40",
      reference: `E2E-VOID-${Date.now()}`,
    });
    await page.getByRole("button", { name: "Anular pago", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    const confirm = dialog.getByRole("button", { name: "Anular", exact: true });
    await expect(confirm).toBeDisabled(); // the reason is required
    await dialog.getByLabel("Motivo", { exact: true }).fill("Pago duplicado E2E");
    await confirm.click();
    await expect(page.getByText("Pago anulado")).toBeVisible();
    await expect(page.getByText("Anulado", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular pago", exact: true })).toHaveCount(0);

    await page.goto(`/payments/${paymentId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/payments/${paymentId}$`));
  });

  test("@authenticated HU-13 edit: an amount below the allocated one is refused (409 INTEGRITY_LOCK); a valid edit is saved", async ({
    page,
  }) => {
    const invoice = await newInvoice(page, "EDIT");
    const paymentId = await registerUsdPayment(page, {
      amount: "100",
      reference: `E2E-EDIT-${Date.now()}`,
      invoiceId: invoice.id,
      allocation: "60",
    });

    await page.getByRole("link", { name: "Editar", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/payments/${paymentId}/edit$`));
    await page.waitForLoadState("networkidle");

    // 50 received with the stored IGTF of 3 is 47 allocatable, below the 60 already allocated.
    await page.locator("#payment-amount").fill("50");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("El monto no puede ser menor que lo ya asignado")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/payments/${paymentId}/edit$`));

    // An edit over the allocated amount is saved and the detail shows it.
    const reference = `E2E-EDITED-${Date.now()}`;
    await page.locator("#payment-amount").fill("120");
    await page.locator("#payment-reference").fill(reference);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Pago actualizado")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/payments/${paymentId}$`));
    await expect(page.getByText(reference)).toBeVisible();
  });
});
