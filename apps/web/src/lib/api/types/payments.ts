import type { components, operations } from "../schema";

// Generated payment DTOs and query types re-exported for the payments module: code outside `src/lib/api/**` may
// not import the schema (ESLint, C8). Nothing here is hand-written: each type is a view of the BE document.

/** One payment (`GET|PATCH /api/v1/payments/{id}` and the status, deallocate and create responses). */
export type PaymentResponseDto = components["schemas"]["PaymentResponseDto"];
/** One live allocation of a payment (the "Asignaciones" rows). */
export type PaymentAllocationResponseDto = components["schemas"]["PaymentAllocationResponseDto"];
/** The stored receipt of a payment (`null` without one). */
export type PaymentReceiptDto = NonNullable<PaymentResponseDto["receipt"]>;
/** `GET /api/v1/payments`: one page of table rows. */
export type PaymentListResponseDto = components["schemas"]["PaymentListResponseDto"];
/** One row of the payments table. */
export type PaymentListRowDto = PaymentListResponseDto["items"][number];
/** `GET /api/v1/payments` query: the flat keys of the list (`api-contract.md` §3). */
export type PaymentListQuery = NonNullable<operations["listPayments"]["parameters"]["query"]>;
export type PaymentListSort = NonNullable<PaymentListQuery["sort"]>;
/** `GET /api/v1/payments/overview`. */
export type PaymentsOverviewDto = components["schemas"]["PaymentsOverviewDto"];
/** `GET /api/v1/payments/duplicates` query and answer. */
export type DuplicatePaymentQuery = operations["detectDuplicatePayment"]["parameters"]["query"];
export type DuplicatePaymentResponseDto = components["schemas"]["DuplicatePaymentResponseDto"];
/** `GET /api/v1/clients/{id}/credit`: the confirmed payments with an unapplied rest. */
export type ClientCreditResponseDto = components["schemas"]["ClientCreditResponseDto"];
/** `GET /api/v1/clients/{id}/open-invoices` row. */
export type OpenInvoiceResponseDto = components["schemas"]["OpenInvoiceResponseDto"];
/** `GET /api/v1/invoices/{id}/payment-context`. */
export type InvoicePaymentContextResponseDto =
  components["schemas"]["InvoicePaymentContextResponseDto"];

/** Request bodies. */
export type CreatePaymentDto = components["schemas"]["CreatePaymentDto"];
export type UpdatePaymentDto = components["schemas"]["UpdatePaymentDto"];
export type SetPaymentStatusDto = components["schemas"]["SetPaymentStatusDto"];
export type AllocatePaymentDto = components["schemas"]["AllocatePaymentDto"];
