import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InvoicesOverview } from "@/features/invoices/components/invoices-overview";
import { getInvoicesOverview } from "@/features/invoices/queries";
import { invoiceScreenPermissions } from "@/features/invoices/permissions";
import { notFoundWhenRefused } from "@/features/invoices/refusal";
import { requireSessionUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices.page");
  return { title: t("overviewTitle") };
}

// `/invoices` overview (PRD §8.5, DT-25: the overview is not the list). Owner and Admin only; other roles get the
// not-found page. Every figure comes from the BE (`GET /invoices/overview`, C17); a role it refuses gets the same page.
export default async function InvoicesOverviewPage() {
  const user = await requireSessionUser();
  const permissions = invoiceScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const overview = await notFoundWhenRefused(getInvoicesOverview);

  return <InvoicesOverview overview={overview} canCreate={permissions.canCreate} />;
}
