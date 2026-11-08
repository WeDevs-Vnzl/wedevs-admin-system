import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";
import { namePrefix } from "./support/accessible-names";

// T10 phase B E2E regression tests, H1-B3 money flows (odd/tasks/h1-b3-finance-ui.md S3, S5, S7), rewritten for FE-INT-R
// E.2 (rule 29): no mock reset and no mock seed id. Every case creates its own client, project, billing plan and
// invoice through the UI, under a name unique to this run, and runs in the `authenticated` project as the user does
// against the local BE (DT-204). Money is asserted as es-VE text from the response.
//
// HU-13 (payments: IGTF, allocation caps, duplicate warning) moved to `fe-int-3-payments.spec.ts` (E.3, DT-220).
// HU-09 and HU-11 also run in `fe-int-3-finance.spec.ts`; these cases keep the H1-B3 regression in its own file.

// es-VE: "4000,00 US$" (no group separator below five digits), "10.000,00 US$".
const money = (digits: string) => new RegExp(`(^|[^\\d.])${digits.replace(".", "\\.?")}`);

const uniq = (label: string) => `E2E money ${label} ${Date.now()}`;

function idFromUrl(url: string, segment: string): string {
  const id = new RegExp(`/${segment}/([^/?#]+)`).exec(url)?.[1];
  if (!id) throw new Error(`No /${segment}/ id in ${url}`);
  return id;
}

/** Creates a client and a project of this run, and generates the 40/30/30 installments of a plan of `contract`. */
async function createBilledProject(
  page: Page,
  contract: string,
): Promise<{ clientId: string; projectId: string }> {
  const clientName = uniq("cliente");
  await page.goto("/clients/new");
  await page.getByLabel("Nombre comercial", { exact: true }).fill(clientName);
  await page
    .getByLabel("Identificador fiscal", { exact: true })
    .fill(`J-${Math.floor(10_000_000 + Math.random() * 89_999_999)}-1`);
  await page.getByLabel("Dirección", { exact: true }).fill("Calle E2E 1");
  await page.locator("#client-phone").fill("+57 300 123 4567");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/[^/?#]+$/);
  const clientId = idFromUrl(page.url(), "clients");

  await page.goto("/projects/new");
  await page.getByLabel("Nombre", { exact: true }).fill(uniq("proyecto"));
  await page.getByLabel("Resumen", { exact: true }).fill("Proyecto E2E de dinero");
  await page.getByRole("combobox", { name: "Clientes", exact: true }).fill(clientName);
  await page.getByRole("option", { name: namePrefix(clientName) }).click();
  await page.getByRole("textbox", { name: `Rol: ${clientName}`, exact: true }).fill("Contratante");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}/);
  const projectId = idFromUrl(page.url(), "projects");

  await page.goto(`/projects/${projectId}/billing`);
  await page.locator("#plan-contract").fill(contract);
  await page.getByRole("button", { name: "Crear plan", exact: true }).click();
  await expect(page.getByText("Plan de facturación guardado")).toBeVisible();
  await page.getByRole("button", { name: "Aplicar plantilla", exact: true }).click();
  await expect(page.getByText("Cuotas generadas desde la plantilla")).toBeVisible();
  return { clientId, projectId };
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test.beforeAll(async () => {
  await assertBackendHealthy();
});

test("@authenticated HU-09 CA1/CA2: 40/30/30 over 10 000 USD gives 4 000, 3 000, 3 000; a mismatch shows a persistent warning", async ({
  page,
}) => {
  await signInAs(page, "OWNER");
  const { projectId } = await createBilledProject(page, "10000");

  await open(page, `/projects/${projectId}/billing`);
  const table = page.getByRole("table").first();
  await expect(table.getByText(money("4.000,00"))).toHaveCount(1);
  await expect(table.getByText(money("3.000,00"))).toHaveCount(2);
  await expect(page.getByText("Las cuotas no suman el monto contratado")).toHaveCount(0);

  // CA2: the contract changes to 11 000 → the non-AJUSTE installments differ by 1 000: warning, saved anyway.
  await page.locator("#plan-contract").fill("11000");
  await page.getByRole("button", { name: "Guardar plan", exact: true }).click();
  await expect(page.getByText("Plan de facturación guardado")).toBeVisible();
  await expect(page.getByText("Las cuotas no suman el monto contratado")).toBeVisible();
  await open(page, `/projects/${projectId}/billing`);
  await expect(page.getByText("Las cuotas no suman el monto contratado")).toBeVisible();
});

test("@authenticated HU-11 CA1/CA2/CA5 + HU-09 CA3: billing a pending installment creates its line, live totals, FACTURADA and locked", async ({
  page,
}) => {
  await signInAs(page, "OWNER");
  const { clientId, projectId } = await createBilledProject(page, "10000");

  await open(page, `/invoices/new?clientId=${clientId}`);
  const checkbox = page.getByRole("checkbox", { name: "Facturar la cuota Cuota 1", exact: true });
  await expect(checkbox).toBeVisible();
  await checkbox.click();
  // The form starts with one blank manual line; the installment line is appended after it.
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
  await open(page, `/invoices/new?clientId=${clientId}`);
  await expect(
    page.getByRole("checkbox", { name: "Facturar la cuota Cuota 1", exact: true }),
  ).toHaveCount(0);
  await open(page, `/projects/${projectId}/billing`);
  const row = page.getByRole("row", { name: /Cuota 1\b/ });
  await expect(row.getByText("Facturada").first()).toBeVisible();

  // HU-09 CA3: a billed installment keeps its amount and currency (only the label is editable).
  await row.getByRole("button", { name: "Editar Cuota 1", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Cuota facturada: solo se puede cambiar la etiqueta."),
  ).toBeVisible();
  await expect(dialog.getByLabel("Monto", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Nombre", { exact: true })).toBeEnabled();
});

// HU-13 (payments, IGTF, allocation caps and the duplicate warning) moved to `fe-int-3-payments.spec.ts` (E.3).
