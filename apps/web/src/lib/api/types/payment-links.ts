import type { components } from "../schema";

// Generated payment-link DTOs re-exported for the invoices module: code outside `src/lib/api/**` may not import
// the schema (ESLint, C8). Nothing here is hand-written: each type is a view of the BE OpenAPI document.

/** `GET /api/v1/invoices/{id}/payment-links`: the remaining `capacity` and every link, newest first. */
export type InvoicePaymentLinksResponseDto = components["schemas"]["InvoicePaymentLinksResponseDto"];

/** One link (also the answer of the create and deactivate commands); `amount` and `capacity` are decimal strings (C15). */
export type PaymentLinkResponseDto = components["schemas"]["PaymentLinkResponseDto"];
export type PaymentLinkStatus = PaymentLinkResponseDto["status"];

/** `POST /api/v1/invoices/{id}/payment-links`. */
export type CreatePaymentLinkDto = components["schemas"]["CreatePaymentLinkDto"];
