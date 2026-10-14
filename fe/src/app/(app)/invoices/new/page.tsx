import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { InvoiceForm } from "@/features/invoices/components/invoice-form";
import { loadInvoiceFormOptions } from "@/features/invoices/form-options";
import { invoiceScreenPermissions } from "@/features/invoices/permissions";
import { requireSessionUser } from "@/server/auth/session";

type NewInvoicePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices.page");
  return { title: t("newTitle") };
}

/** `?installments=` takes the ids as one comma-separated value or as repeated keys. */
function idsOf(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

// `/invoices/new` (PRD §8.5, §11): a new invoice. `?clientId=` opens it for a client; `?installments=` preselects
// the pending installments of that client as lines ("Facturar cuotas", HU-11 CA1). Owner and Admin only.
export default async function NewInvoicePage({ searchParams }: NewInvoicePageProps) {
  const user = await requireSessionUser();
  const permissions = invoiceScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const params = await searchParams;
  const clientParam = typeof params.clientId === "string" ? params.clientId : "";
  const options = await loadInvoiceFormOptions(clientParam);
  const wanted = new Set(idsOf(params.installments));
  const preselected = options.billable.filter((row) => wanted.has(row.installment.id));
  const t = await getTranslations("invoices");

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment="new" label={t("page.newTitle")} />
      <InvoiceForm
        clients={options.clients}
        currencies={options.currencies}
        ivaRates={options.ivaRates}
        defaultIvaRate={options.defaultIvaRate}
        today={options.today}
        defaultDueDays={options.defaultDueDays}
        initialClientId={clientParam}
        billable={options.billable}
        preselected={preselected}
      />
    </div>
  );
}
