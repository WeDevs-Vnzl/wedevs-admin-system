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
import { ListCode, SimpleListCard } from "@/components/patterns/simple-list-card";
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
  return <ListCode href={`/projects/${row.id}`} code={row.code} name={row.name} />;
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
          views={
            <OverviewTableToggle
              current="overview"
              overviewHref="/projects"
              tableHref="/projects/list"
            />
          }
          actions={
            <>
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
          <StatCard
            label={t("kpiByStatus")}
            value={total}
            hint={t("projectCount", { count: total })}
          />
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
            <SimpleListCard
              title={t("upcomingTitle")}
              emptyTitle={t("upcomingEmpty")}
              rows={overview.upcomingDeliveries.map((row) => ({
                id: row.id,
                label: <ProjectLink row={row} />,
                values: [
                  {
                    node: (
                      <span className="text-muted-foreground">
                        {row.targetEndDate
                          ? formatDate(row.targetEndDate, locale)
                          : tDetail("notSet")}
                      </span>
                    ),
                  },
                ],
              }))}
            />

            <SimpleListCard
              title={t("noPlanTitle")}
              emptyTitle={t("noPlanEmpty")}
              rows={overview.withoutBillingPlan.map((row) => ({
                id: row.id,
                label: <ProjectLink row={row} />,
              }))}
            />
          </div>

          {showFinancials ? (
            <SimpleListCard
              title={t("toInvoiceTitle")}
              emptyTitle={t("toInvoiceEmpty")}
              rows={overview.highestToInvoice.map((row) => ({
                id: row.id,
                label: <ProjectLink row={row} />,
                values: [{ node: <MoneyText amount={row.toInvoiceUsd} currency="USD" /> }],
              }))}
            />
          ) : null}
        </>
      }
      aside={
        <>
          <SimpleListCard
            title={t("topTechTitle")}
            emptyTitle={t("topTechEmpty")}
            rows={overview.topTechnologies.map(({ technology, projectCount }) => ({
              id: technology.id,
              label: technologyLabel(technology, locale),
              values: [
                {
                  node: (
                    <span className="text-muted-foreground">
                      {t("usesTech", { count: projectCount })}
                    </span>
                  ),
                },
              ],
            }))}
          />
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
