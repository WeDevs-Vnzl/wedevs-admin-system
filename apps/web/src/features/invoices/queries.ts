import "server-only";
import { idSchema } from "@/lib/validators/common";
import { invoiceFiltersSchema } from "@/lib/validators/invoices";
import * as invoices from "@/mocks/services/invoices";
import { getServiceContext } from "@/server/context";
import type { InvoiceFilterInput } from "./components/invoice-table-query";

// Reads for the invoices pages (RSC). Each read resolves the session in `getServiceContext` and parses its input
// with the contract schema. Pages call `notFound()` when `getInvoice` throws `NOT_FOUND`.

/** One page of `/invoices/list` for the URL query; `includeArchived` is part of the filter schema. */
export async function listInvoices(input: InvoiceFilterInput = {}) {
  return invoices.listInvoices(await getServiceContext(), invoiceFiltersSchema.parse(input));
}

export async function getInvoicesOverview() {
  return invoices.getInvoicesOverview(await getServiceContext());
}

export async function getInvoice(id: string) {
  return invoices.getInvoice(await getServiceContext(), idSchema.parse(id));
}

/** Pending installments of the client's projects, for the "Facturar cuotas" wizard. */
export async function listBillableInstallments(clientId: string) {
  return invoices.listBillableInstallments(await getServiceContext(), idSchema.parse(clientId));
}
