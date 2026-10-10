// MOCK — invoices fixtures of Hito 1 (data-rules.md §2, §3a Δ1). Typed empty stubs: the module package that
// builds the invoices UI fills them and owns this file from then on. Fixtures store the inputs (lines with
// their rates and discounts); the derived fields and the tax lines are computed through `lib/finance` by a
// `derive` hook of the store (C17).
import type { InvoiceDetailDTO, InvoiceTaxLineDTO } from "@/lib/validators/invoices";

/**
 * Δ1 `InvoiceTaxLine` row: one per distinct VAT rate of an invoice, unique on `(invoiceId, ivaRate)`.
 * `ivaAmount` is `round(taxBase × ivaRate / 100, 2) + adjustment`, the adjustment staying within ±0.01.
 */
export interface InvoiceTaxLineRow extends InvoiceTaxLineDTO {
  id: string;
  invoiceId: string;
}

export const invoiceFixtures: InvoiceDetailDTO[] = [];
export const invoiceTaxLineFixtures: InvoiceTaxLineRow[] = [];
