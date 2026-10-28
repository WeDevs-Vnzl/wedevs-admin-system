import "server-only";
import { listCurrencies, getFiscalSettings } from "@/features/catalogs/queries";
import { listClients } from "@/features/clients/queries";
import { todayInCaracas } from "@/lib/dates";
import { ServiceError } from "@/server/errors";
import { listBillableInstallments } from "./queries";

// Options the invoice form needs on the server: the clients to bill, the currencies, the fiscal settings (allowed
// VAT rates, default rate and due days) and the pending installments of the selected client ("Facturar cuotas").

export async function loadInvoiceFormOptions(clientId: string) {
  const [clientsPage, currencies, fiscal] = await Promise.all([
    listClients({ pageSize: 100 }),
    listCurrencies(),
    getFiscalSettings(),
  ]);
  return {
    clients: clientsPage.items.map((client) => ({ id: client.id, name: client.tradeName })),
    currencies: currencies.map((currency) => ({ code: currency.code, name: currency.name })),
    ivaRates: fiscal.ivaRates,
    defaultIvaRate: fiscal.ivaDefaultRate,
    defaultDueDays: fiscal.invoiceDefaultDueDays,
    today: todayInCaracas(new Date()),
    billable: await billableOf(clientId),
  };
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
