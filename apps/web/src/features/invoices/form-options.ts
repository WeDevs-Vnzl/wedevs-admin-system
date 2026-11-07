import "server-only";
import { listCurrencies, getFiscalSettings } from "@/features/catalogs/queries";
import { getClient } from "@/features/clients/queries";
import { todayInCaracas } from "@/lib/dates";
import { ServiceError } from "@/lib/service-error";
import { listBillableInstallments } from "./queries";

// Options the invoice form needs on the server: the client preselected from the URL (resolved by id, so it is named
// even though it is in no list), the currencies, the fiscal settings (allowed VAT rates, default rate and due days)
// and the pending installments of the selected client ("Facturar cuotas"). Clients are searched by the form itself.

export async function loadInvoiceFormOptions(clientId: string) {
  const [initialClient, currencies, fiscal] = await Promise.all([
    preselectedClientOf(clientId),
    listCurrencies(),
    getFiscalSettings(),
  ]);
  return {
    initialClient,
    currencies: currencies.map((currency) => ({ code: currency.code, name: currency.name })),
    ivaRates: fiscal.ivaRates,
    defaultIvaRate: fiscal.ivaDefaultRate,
    defaultDueDays: fiscal.invoiceDefaultDueDays,
    today: todayInCaracas(new Date()),
    billable: await billableOf(clientId),
  };
}

/** A client id from the URL may be unknown or refused: then nothing is preselected, as for the wizard. */
async function preselectedClientOf(clientId: string) {
  if (!clientId) return null;
  try {
    const client = await getClient(clientId);
    return { id: client.id, name: client.tradeName };
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      return null;
    }
    throw error;
  }
}

/** A client id from the URL may be unknown: that is an empty wizard, not a broken page. */
async function billableOf(clientId: string) {
  if (!clientId) return [];
  try {
    return await listBillableInstallments(clientId);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return [];
    throw error;
  }
}
