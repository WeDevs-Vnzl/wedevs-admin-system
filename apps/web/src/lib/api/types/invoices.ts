import type { components, operations } from "../schema";

// Generated invoice DTOs re-exported for the invoices module: code outside `src/lib/api/**` may not import the
// schema (ESLint, C8). Nothing here is hand-written: each type is a view of the BE OpenAPI document.

/** One invoice with its lines, tax lines, totals and allocations (`GET|PATCH /api/v1/invoices/{id}`; also the answer of every invoice write). */
export type InvoiceResponseDto = components["schemas"]["InvoiceResponseDto"];
export type InvoiceLineDto = InvoiceResponseDto["lines"][number];
export type InvoiceTaxLineDto = InvoiceResponseDto["taxLines"][number];
export type InvoiceAllocationDto = InvoiceResponseDto["allocations"][number];

/** `GET /api/v1/invoices`: one page of rows. */
export type InvoiceListResponseDto = components["schemas"]["InvoiceListResponseDto"];
export type InvoiceListItemDto = InvoiceListResponseDto["items"][number];

/** `GET /api/v1/invoices` query: the flat keys of the list (`api-contract.md` §3). */
export type InvoiceListQuery = NonNullable<operations["listInvoices"]["parameters"]["query"]>;
export type InvoiceListSort = NonNullable<InvoiceListQuery["sort"]>;

/** `GET /api/v1/invoices/overview`. */
export type InvoicesOverviewDto = components["schemas"]["InvoicesOverviewDto"];

/** `GET /api/v1/clients/{id}/billable-installments` (the wire `code` is `string | null`). */
export type BillableInstallmentResponseDto =
  components["schemas"]["BillableInstallmentResponseDto"];

/** Request bodies. */
export type CreateInvoiceDto = components["schemas"]["CreateInvoiceDto"];
export type UpdateInvoiceDto = components["schemas"]["UpdateInvoiceDto"];
export type VoidInvoiceDto = components["schemas"]["VoidInvoiceDto"];
export type AttachInvoiceFileDto = components["schemas"]["AttachInvoiceFileDto"];

/** `POST /api/v1/invoices/{id}/restore`: the restored record's reference and when. */
export type RestoredInvoiceResponseDto = components["schemas"]["RestoredInvoiceResponseDto"];
