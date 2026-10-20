import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InstallmentsTable } from "@/features/billing/components/installments-table";
import { PlanCard } from "@/features/billing/components/plan-card";
import { RecurringChargesTable } from "@/features/billing/components/recurring-charges-table";
import { getBillingPage } from "@/features/billing/queries";
import { listCurrencies } from "@/features/catalogs/queries";
import { loadProjectOr404 } from "@/features/projects/load-project";
import { can } from "@/server/auth/permissions";
import { requireSessionUser } from "@/server/auth/session";

type ProjectBillingPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: ProjectBillingPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("billing.page");
  try {
    const project = await loadProjectOr404(id);
    return { title: `${t("title")} · ${project.name}` };
  } catch {
    return { title: t("title") };
  }
}

// `/projects/[id]/billing` (PRD §8.4, §11): the billing plan with its quick template, the installments and the
// recurring charges of one project. Only the finance roles read it (`read` on `billing`); a project the user
// cannot see, or a Viewer, gets the in-shell not-found page. An archived project is read-only.
export default async function ProjectBillingPage({ params }: ProjectBillingPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  if (!can(user, "read", "billing")) notFound();
  const project = await loadProjectOr404(id);
  const [page, currencies] = await Promise.all([getBillingPage(project.id), listCurrencies()]);
  const t = await getTranslations("billing.page");

  const canEdit = can(user, "update", "billing") && project.archivedAt === null;
  const currencyOptions = currencies.map((currency) => ({
    code: currency.code,
    name: currency.name,
  }));
  const defaultCurrency = page.plan?.currency ?? "USD";

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={project.id} label={`${project.code} · ${project.name}`} />
      <header className="space-y-2">
        <Link
          href={`/projects/${project.id}?tab=billing`}
          className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("back")}
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </header>
      {project.archivedAt !== null ? (
        <Alert>
          <AlertDescription>{t("readOnly")}</AlertDescription>
        </Alert>
      ) : null}
      <PlanCard
        projectId={project.id}
        plan={page.plan}
        currencies={currencyOptions}
        canEdit={canEdit}
      />
      <InstallmentsTable
        projectId={project.id}
        installments={page.installments}
        currencies={currencyOptions}
        defaultCurrency={defaultCurrency}
        canEdit={canEdit}
      />
      <RecurringChargesTable
        projectId={project.id}
        charges={page.recurringCharges}
        currencies={currencyOptions}
        defaultCurrency={defaultCurrency}
        canEdit={canEdit}
      />
    </div>
  );
}
