import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { invoiceScreenPermissions } from "@/features/invoices/permissions";
import { getInvoice } from "@/features/invoices/queries";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";

type InvoiceDetailPageProps = {
  params: Promise<{ id: string }>;
};

async function readInvoice(id: string) {
  try {
    return await getInvoice(id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

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

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={invoice.id} label={invoice.invoiceNumber} />
      <InvoiceDetail invoice={invoice} canUpdate={permissions.canUpdate} />
    </div>
  );
}
