import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PaymentForm } from "@/features/payments/components/payment-form";
import { getPaymentFormOptions } from "@/features/payments/form-options";
import { paymentScreenPermissions } from "@/features/payments/permissions";
import { getInvoiceForPayment, listOpenInvoices } from "@/features/payments/queries";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/lib/auth/session";

type PaymentNewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.page");
  return { title: t("newTitle") };
}

// `/payments/new` (HU-13). Roles without the payment create grant get the not-found page. `?invoiceId=` preselects
// the client and ticks that invoice; an invoice that no longer takes a payment (the BE's `404`, DT-133) opens the
// empty form.
export default async function NewPaymentPage({ searchParams }: PaymentNewPageProps) {
  const user = await requireSessionUser();
  const permissions = paymentScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const { invoiceId } = await searchParams;
  const requestedInvoice =
    typeof invoiceId === "string" ? await getInvoiceForPayment(invoiceId) : null;

  const [options, openInvoices] = await Promise.all([
    getPaymentFormOptions(),
    requestedInvoice ? listOpenInvoices(requestedInvoice.client.id) : Promise.resolve([]),
  ]);

  return (
    <PaymentForm
      {...options}
      today={todayInCaracas(new Date())}
      initialClient={
        requestedInvoice
          ? { id: requestedInvoice.client.id, name: requestedInvoice.client.label }
          : null
      }
      initialOpenInvoices={openInvoices}
      initialInvoiceId={requestedInvoice?.invoice.id}
    />
  );
}
