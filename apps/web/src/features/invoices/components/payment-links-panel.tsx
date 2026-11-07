import { listInvoicePaymentLinks } from "@/features/invoices/payment-links";
import { PaymentLinksView } from "./payment-links-view";

type PaymentLinksPanelProps = {
  invoiceId: string;
  currency: string;
  /** Cosmetic (`payment` `create`, DT-195): the BE decides. */
  canCreate: boolean;
};

/**
 * The "Payment links" panel of the invoice detail (6.1), an async server component mounted through the
 * `paymentLinks` prop of `InvoiceDetail` inside `<Suspense fallback={null}>` (rule 24). It renders nothing when the
 * Stripe integration is off (`404`, DT-193) and when the read fails, so the invoice page never breaks on it.
 */
export async function PaymentLinksPanel({ invoiceId, currency, canCreate }: PaymentLinksPanelProps) {
  let data;
  try {
    data = await listInvoicePaymentLinks(invoiceId);
  } catch {
    return null;
  }
  if (!data) return null;

  return (
    <PaymentLinksView
      invoiceId={invoiceId}
      currency={currency}
      capacity={data.capacity}
      links={data.links}
      canCreate={canCreate}
    />
  );
}
