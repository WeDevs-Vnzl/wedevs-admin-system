"use server";

import { apiAction } from "@/lib/api/action";
import type { PaymentLinkResponseDto } from "@/lib/api/types/payment-links";

// Thin API proxies (C10) for the payment-links panel (6.1, DT-195…DT-197). The BE decides the capacity, the minimum,
// the supported currencies and whether the invoice is open; the FE only forwards the amount string the user sees
// (C15) and the `requestId` of the open dialog (DT-196).

type CreatePaymentLinkInput = { invoiceId: string; amount: string; requestId: string };
type DeactivatePaymentLinkInput = { invoiceId: string; linkId: string };

export const createPaymentLinkAction = apiAction<CreatePaymentLinkInput, PaymentLinkResponseDto>({
  call: ({ invoiceId, amount, requestId }, api) =>
    api.POST("/api/v1/invoices/{id}/payment-links", {
      params: { path: { id: invoiceId } },
      body: { amount, requestId },
    }),
  revalidate: (input) => [`/invoices/${input.invoiceId}`],
});

export const deactivatePaymentLinkAction = apiAction<
  DeactivatePaymentLinkInput,
  PaymentLinkResponseDto
>({
  call: ({ invoiceId, linkId }, api) =>
    api.POST("/api/v1/invoices/{id}/payment-links/{linkId}/deactivate", {
      params: { path: { id: invoiceId, linkId } },
    }),
  revalidate: (input) => [`/invoices/${input.invoiceId}`],
});
