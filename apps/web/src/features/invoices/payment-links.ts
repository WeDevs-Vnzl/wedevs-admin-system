import "server-only";
import { toActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { InvoicePaymentLinksResponseDto } from "@/lib/api/types/payment-links";
import { idSchema } from "@/lib/validators/common";

/**
 * `GET /api/v1/invoices/{id}/payment-links` (6.1): the remaining `capacity` and every link, newest first, as the BE
 * returned them. `null` when the BE answers `404`: the Stripe integration is off (DT-193) and the panel is not
 * shown. Any other failure throws, so the panel can hide itself without breaking the invoice page (rule 24).
 */
export async function listInvoicePaymentLinks(
  invoiceId: string,
): Promise<InvoicePaymentLinksResponseDto | null> {
  const api = await getServerApi();
  const result = toActionResult(
    await api.GET("/api/v1/invoices/{id}/payment-links", {
      params: { path: { id: idSchema.parse(invoiceId) } },
    }),
  );
  if (result.ok) return result.data;
  if (result.error.code === "NOT_FOUND") return null;
  throw new Error(`Payment links read failed: ${result.error.code}`);
}
