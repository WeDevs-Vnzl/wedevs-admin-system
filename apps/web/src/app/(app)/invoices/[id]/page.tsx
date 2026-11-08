import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { PaymentLinksPanel } from "@/features/invoices/components/payment-links-panel";
import { invoiceScreenPermissions } from "@/features/invoices/permissions";
import { getInvoice } from "@/features/invoices/queries";
import { orNullWhenMissing } from "@/features/invoices/refusal";
import { getFeatures } from "@/features/shell/features";
import { can } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";

type InvoiceDetailPageProps = {
  params: Promise<{ id: string }>;
};

// A missing, hidden or refused (`FORBIDDEN`) invoice answers `null`: the page is the same not-found for all of them.
const readInvoice = (id: string) => orNullWhenMissing(() => getInvoice(id));

export async function generateMetadata({ params }: InvoiceDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("invoices.page");
  const invoice = await readInvoice(id);
  return { title: invoice ? invoice.invoiceNumber : t("detailTitle") };
}

// `/invoices/[id]` (PRD §8.5): the invoice with its lines, its per-rate totals, its payments and its PDF. Unknown
// ids and roles without the invoice grant get the not-found page.
export default async function InvoiceDetailPage({ params }: InvoiceDetailPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = invoiceScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const invoice = await readInvoice(id);
  if (!invoice) notFound();
  const { stripe } = await getFeatures();

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={invoice.id} label={invoice.invoiceNumber} />
      <InvoiceDetail
        invoice={invoice}
        canUpdate={permissions.canUpdate}
        paymentLinks={
          // Cosmetic gates (DT-195, DT-227): the BE decides. Not rendered while Stripe is off; the panel also hides
          // itself when its read fails.
          stripe && can(user, "read", "payment") ? (
            <Suspense fallback={null}>
              <PaymentLinksPanel
                invoiceId={invoice.id}
                currency={invoice.currency}
                canCreate={can(user, "create", "payment")}
              />
            </Suspense>
          ) : undefined
        }
      />
    </div>
  );
}
