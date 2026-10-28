import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { InvoiceForm } from "@/features/invoices/components/invoice-form";
import { loadInvoiceFormOptions } from "@/features/invoices/form-options";
import { invoiceScreenPermissions } from "@/features/invoices/permissions";
import { getInvoice } from "@/features/invoices/queries";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";

type EditInvoicePageProps = {
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

export async function generateMetadata({ params }: EditInvoicePageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("invoices.page");
  const invoice = await readInvoice(id);
  return { title: invoice ? `${t("editTitle")} · ${invoice.invoiceNumber}` : t("editTitle") };
}

// `/invoices/[id]/edit` (PRD §8.5): the same form as a new invoice, loaded with the stored lines. A voided or
// archived invoice is read-only: it goes back to its detail.
export default async function EditInvoicePage({ params }: EditInvoicePageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = invoiceScreenPermissions(user);
  if (!permissions.canUpdate) notFound();
  const invoice = await readInvoice(id);
  if (!invoice) notFound();
  if (invoice.voidedAt !== null) notFound();

  const options = await loadInvoiceFormOptions(invoice.client.id);

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={invoice.id} label={invoice.invoiceNumber} />
      <InvoiceForm
        invoice={invoice}
        clients={options.clients}
        currencies={options.currencies}
        ivaRates={options.ivaRates}
        defaultIvaRate={options.defaultIvaRate}
        today={options.today}
        defaultDueDays={options.defaultDueDays}
        initialClientId={invoice.client.id}
        billable={options.billable}
        preselected={[]}
      />
    </div>
  );
}
