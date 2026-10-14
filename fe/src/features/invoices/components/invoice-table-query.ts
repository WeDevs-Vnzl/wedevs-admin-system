import { toModuleQuery } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import type { invoiceFiltersSchema } from "@/lib/validators/invoices";
import type { z } from "@/lib/validators/zod";
import { INVOICE_FACETS } from "../columns";

export type InvoiceFilterInput = z.input<typeof invoiceFiltersSchema>;

/**
 * The table's list query as the invoices filter: facets go to their module keys (`clientId`, `issued` →
 * `dateFrom` / `dateTo`). Shared by the server page and the table, so both read the same page for a URL.
 */
export function invoiceFilterOf(query: ListQuery): InvoiceFilterInput {
  return toModuleQuery(query, INVOICE_FACETS) as InvoiceFilterInput;
}
