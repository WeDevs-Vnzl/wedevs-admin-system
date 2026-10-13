import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PlusIcon } from "lucide-react";
import { AlertList } from "@/features/alerts/components/alert-list";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { MoneyText } from "@/components/patterns/money-text";
import { OverviewLayout } from "@/components/patterns/overview-layout";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { StatCard } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import { ProjectsStatusChart } from "@/features/projects/components/projects-status-chart";
import { getProjectsOverview } from "@/features/projects/queries";
import { technologyLabel } from "@/features/technologies/label";
import { formatDate } from "@/lib/dates";
import { isLocale, type Locale } from "@/i18n/config";
import { PROJECT_STATUS_VALUES } from "@/lib/validators/enums";
import type { ProjectListRowDTO } from "@/lib/validators/projects";
import { requireSessionUser } from "@/server/auth/session";
import { can, canSeeFinancials } from "@/server/auth/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects.page");
  return { title: t("title") };
}

/** One row of a project list: code and name linked to the detail. */
function ProjectLink({ row }: { row: ProjectListRowDTO }) {
  return (
    <Link href={`/projects/${row.id}`} className="hover:underline">
      <span className="font-mono text-xs text-muted-foreground">{row.code}</span> {row.name}
    </Link>
  );
}

// `/projects` overview (wireframe 4.2, PRD §8.3): projects by status, upcoming deliveries, projects without a
// billing plan, top technologies and, for finance roles, the highest amounts to invoice and the installments
// to invoice. Money is shown as USD decimal strings (C15); the service computes it, the screen never does.
export default async function ProjectsOverviewPage() {
  const user = await requireSessionUser();
  const showFinancials = canSeeFinancials(user);
  const canCreate = can(user, "create", "project");
  const overview = await getProjectsOverview();
  const t = await getTranslations("projects.overview");
  const tPage = await getTranslations("projects.page");
  const tStatus = await getTranslations("enums.ProjectStatus");
  const tDetail = await getTranslations("projects.detail");
  const localeValue = await getLocale();
  const locale: Locale = isLocale(localeValue) ? localeValue : "es";

  const chartData = PROJECT_STATUS_VALUES.map((status) => ({
    status,
    label: tStatus(status),
    count: overview.countByStatus[status] ?? 0,
  }));
  const total = chartData.reduce((sum, item) => sum + item.count, 0);
  const inProgress = overview.countByStatus.EN_CURSO ?? 0;

  return (
    <OverviewLayout
      header={
        <PageHeader
          title={tPage("title")}
          description={tPage("description")}
          actions={
            <>
              <OverviewTableToggle current="overview" overviewHref="/projects" tableHref="/projects/list" />
              {canCreate ? (
                <Button asChild>
                  <Link href="/projects/new">
                    <PlusIcon aria-hidden />
                    {tPage("newAction")}
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />
      }
      kpis={
        <>
          <StatCard label={t("kpiByStatus")} value={total} hint={t("projectCount", { count: total })} />
          <StatCard label={tStatus("EN_CURSO")} value={inProgress} />
          <StatCard label={tStatus("PROPUESTA")} value={overview.countByStatus.PROPUESTA ?? 0} />
          <StatCard label={tStatus("ENTREGADO")} value={overview.countByStatus.ENTREGADO ?? 0} />
        </>
      }
      main={
        <>
          <SectionCard title={t("byStatusTitle")}>
            <ProjectsStatusChart
              data={chartData}
              countLabel={t("projectCount", { count: 1 })}
              label={t("chartLabel")}
            />
          </SectionCard>

          <div className="grid gap-6 md:grid-cols-2">
            <SectionCard title={t("upcomingTitle")}>
              {overview.upcomingDeliveries.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("upcomingEmpty")}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {overview.upcomingDeliveries.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3">
                      <ProjectLink row={row} />
                      <span className="text-muted-foreground tabular-nums">
                        {row.targetEndDate ? formatDate(row.targetEndDate, locale) : tDetail("notSet")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title={t("noPlanTitle")}>
              {overview.withoutBillingPlan.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noPlanEmpty")}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {overview.withoutBillingPlan.map((row) => (
                    <li key={row.id}>
                      <ProjectLink row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {showFinancials ? (
            <SectionCard title={t("toInvoiceTitle")}>
              {overview.highestToInvoice.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("toInvoiceEmpty")}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {overview.highestToInvoice.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3">
                      <ProjectLink row={row} />
                      <MoneyText amount={row.toInvoiceUsd} currency="USD" />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          ) : null}
        </>
      }
      aside={
        <>
          <SectionCard title={t("topTechTitle")}>
            {overview.topTechnologies.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("topTechEmpty")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {overview.topTechnologies.map(({ technology, projectCount }) => (
                  <li key={technology.id} className="flex items-center justify-between gap-3">
                    <span>{technologyLabel(technology, locale)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {t("usesTech", { count: projectCount })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          {showFinancials ? (
            <SectionCard title={t("alertsTitle")}>
              <AlertList variant="full" types={["INSTALLMENT_TO_INVOICE"]} />
            </SectionCard>
          ) : null}
        </>
      }
    />
  );
}
