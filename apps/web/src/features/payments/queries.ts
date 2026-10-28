import "server-only";
import { idSchema } from "@/lib/validators/common";
import { paymentFiltersSchema, type PaymentFilters } from "@/lib/validators/payments";
import * as payments from "@/mocks/services/payments";
import { getServiceContext } from "@/server/context";

// Reads for the payment pages (RSC). Each read resolves the session in `getServiceContext` and parses its input
// with the contract schema. Pages call `notFound()` when `getPayment` throws `NOT_FOUND`.

export async function listPayments(input: Record<string, unknown> = {}) {
  return payments.listPayments(await getServiceContext(), paymentFiltersSchema.parse(input));
}

export async function getPaymentsOverview() {
  return payments.getPaymentsOverview(await getServiceContext());
}

export async function getPayment(id: string) {
  return payments.getPayment(await getServiceContext(), idSchema.parse(id));
}

export async function getClientCredit(clientId: string) {
  return payments.getClientCredit(await getServiceContext(), idSchema.parse(clientId));
}

export async function listOpenInvoices(clientId: string) {
  return payments.listOpenInvoicesForClient(await getServiceContext(), idSchema.parse(clientId));
}

export async function getInvoiceForPayment(invoiceId: string) {
  return payments.getInvoiceForPayment(await getServiceContext(), idSchema.parse(invoiceId));
}

export type { PaymentFilters };
