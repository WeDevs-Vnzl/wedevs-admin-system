import { expect, test } from "@playwright/test";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import {
  createAccountViaUi,
  createClientViaUi,
  createInvoiceViaUi,
  openPage,
} from "./support/ui-data";

// FE-INT-R E.3 integrations E2E (DT-183, DT-184, DT-193): with Stripe and Binance off (the local default: no
// provider keys) the invoice detail shows no payment-links panel and a wallet account shows no Binance snapshot, and
// the account mapping of Settings → Integraciones saves. Personal access tokens are covered by `fe-int-1-identity`
// (E.0) and are not repeated here. The Stripe-on and Binance-on flows need a live third-party service (W5 rule 30):
// they stay with the BE e2e and the HTTP-mocked unit tests, and appear below as `test.fixme` naming the batch-close
// manual check. Runs in the `authenticated` project against the local BE (safeguards.md rule 1); nothing here starts
// a server. Every record is created through the UI with a unique name (W5 rule 29). Copy is Spanish (the Owner's
// default locale).
//
// The mapping case changes a global setting; it clears the mapping again in a `finally`, so run the authenticated
// project with `--workers=1`.

const RUN = Date.now();

test.describe("FE-INT-6 integrations (off by default)", () => {
  test.beforeAll(async () => {
    await assertBackendHealthy();
  });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "OWNER");
  });

  test("@authenticated the invoice detail shows no payment-links panel while Stripe is off", async ({
    page,
  }) => {
    const clientName = `E2E Integraciones ${RUN}`;
    await createClientViaUi(page, clientName, `E2E-INT-${RUN}`);
    const invoice = await createInvoiceViaUi(page, {
      clientName,
      invoiceNumber: `E2E-INT-${RUN}`,
      price: "100",
    });
    await openPage(page, `/invoices/${invoice.id}`);
    // The invoice itself rendered (its number is the page title), and the Stripe panel is not there.
    await expect(page.getByRole("heading", { level: 1, name: invoice.invoiceNumber })).toBeVisible();
    await expect(page.getByText("Enlaces de pago", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Crear enlace", exact: true })).toHaveCount(0);
  });

  test("@authenticated a wallet account shows no Binance snapshot while Binance is off", async ({
    page,
  }) => {
    const id = await createAccountViaUi(page, {
      name: `E2E Wallet ${RUN}`,
      type: "Wallet cripto",
      currency: "USDT",
    });
    await openPage(page, `/accounts/${id}`);
    await expect(page.getByText(`E2E Wallet ${RUN}`).first()).toBeVisible();
    await expect(page.getByText("Snapshot de Binance", { exact: true })).toHaveCount(0);
  });

  test("@authenticated Settings → Integraciones saves the Binance wallet mapping and keeps it after a reload", async ({
    page,
  }) => {
    const wallet = `E2E Wallet mapeo ${RUN}`;
    await createAccountViaUi(page, { name: wallet, type: "Wallet cripto", currency: "USDT" });

    await openPage(page, "/settings/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integraciones" })).toBeVisible();
    try {
      await page.locator("#integrations-binance-account").click();
      await page.getByRole("option", { name: `${wallet} (USDT)`, exact: true }).click();
      await page.getByRole("button", { name: "Guardar asignación", exact: true }).click();
      await expect(page.getByText("Asignación guardada")).toBeVisible();

      await openPage(page, "/settings/integrations");
      await expect(page.locator("#integrations-binance-account")).toContainText(wallet);
    } finally {
      await openPage(page, "/settings/integrations");
      await page.locator("#integrations-binance-account").click();
      await page.getByRole("option", { name: "Sin asignar", exact: true }).click();
      await page.getByRole("button", { name: "Guardar asignación", exact: true }).click();
      await expect(page.getByText("Asignación guardada")).toBeVisible();
    }
  });

  test("@authenticated Stripe needs both its account and its payment method (or neither)", async ({
    page,
  }) => {
    const account = `E2E Cuenta Stripe ${RUN}`;
    await createAccountViaUi(page, { name: account, currency: "USD" });

    await openPage(page, "/settings/integrations");
    await page.locator("#integrations-stripe-account").click();
    await page.getByRole("option", { name: `${account} (USD)`, exact: true }).click();
    await page.getByRole("button", { name: "Guardar asignación", exact: true }).click();
    await expect(
      page.getByText("Elige la cuenta y el método de pago, o deja Stripe sin asignar."),
    ).toBeVisible();
    await expect(page.getByText("Asignación guardada")).toHaveCount(0);
  });

  test.fixme(
    "FE-INT-R E.3: creating a Stripe payment link needs Stripe on (live third-party service); covered by the BE e2e, the HTTP-mocked unit tests and the batch-close manual check",
    async () => {},
  );

  test.fixme(
    "FE-INT-R E.3: the Binance snapshot of a wallet account needs Binance on (live third-party service); covered by the BE e2e, the HTTP-mocked unit tests and the batch-close manual check",
    async () => {},
  );
});
