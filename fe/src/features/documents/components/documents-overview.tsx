import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, FilePen, Plus } from "lucide-react";
import { DateText } from "@/components/patterns/date-text";
import { OverviewLayout } from "@/components/patterns/overview-layout";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { SectionCard } from "@/components/patterns/section-card";
import { ListCode, SimpleListCard } from "@/components/patterns/simple-list-card";
import { StatCard } from "@/components/patterns/stat-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { AlertList } from "@/features/alerts/components/alert-list";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import type { AlertType } from "@/lib/validators/alerts";
import type { DocumentListRowDTO, DocumentsOverviewDTO } from "@/lib/validators/documents";
import { DOCUMENT_STATUS_VALUES } from "@/lib/validators/enums";
import { documentsListHref } from "./documents-table-query";

/** The document alerts shown beside the overview (PRD §7.9). */
const DOCUMENT_ALERT_TYPES: readonly AlertType[] = ["DOCUMENT_EXPIRING", "DOCUMENT_EXPIRED"];

const EXPIRY_WINDOWS = [
  ["30", "days30"],
  ["60", "days60"],
  ["90", "days90"],
] as const;

type DocumentsOverviewProps = {
  overview: DocumentsOverviewDTO;
  canCreate: boolean;
};

/**
 * `/documents` overview (PRD §8.9.5) on the module overview pattern: the documents expiring in the next 30, 60
 * and 90 days and the stale drafts as KPIs (each opens the table filtered), the count per category and status
 * and the expiring documents as mini-tables, the recent documents as a simple list, and the stale drafts and the
 * document alerts aside. The table of documents lives on `/documents/list`.
 */
export async function DocumentsOverview({ overview, canCreate }: DocumentsOverviewProps) {
  const t = await getTranslations("documents");
  const locale = await getLocale();

  const documentLabel = (row: DocumentListRowDTO) => (
    <ListCode href={`/documents/${row.id}`} code={row.code} name={row.title} />
  );
  const updatedRow = (row: DocumentListRowDTO) => ({
    id: row.id,
    label: documentLabel(row),
    values: [{ node: <DateText value={new Date(row.updatedAt)} style="short" /> }],
  });

  return (
    <OverviewLayout
      header={
        <PageHeader
          title={t("page.overviewTitle")}
          description={t("page.overviewDescription")}
          views={
            <OverviewTableToggle
              current="overview"
              overviewHref="/documents"
              tableHref="/documents/list"
            />
          }
          actions={
            canCreate ? (
              <Button asChild>
                <Link href="/documents/new">
                  <Plus aria-hidden />
                  {t("page.newAction")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      }
      kpis={
        <>
          {EXPIRY_WINDOWS.map(([days, key]) => (
            <StatCard
              key={key}
              label={t("overview.expiringKpi", { days })}
              value={
                <Link
                  href={documentsListHref({ expiringWithinDays: days })}
                  className="underline-offset-4 hover:underline"
                >
                  {overview.expiringCounts[key]}
                </Link>
              }
              hint={t("overview.expiringHint")}
              icon={CalendarClock}
            />
          ))}
          <StatCard
            label={t("overview.staleKpi")}
            value={
              <Link
                href={documentsListHref({ staleDraft: "true" })}
                className="underline-offset-4 hover:underline"
              >
                {overview.staleDrafts.length}
              </Link>
            }
            hint={t("overview.staleHint")}
            icon={FilePen}
          />
        </>
      }
      main={
        <>
          <RelatedMiniTable
            title={t("overview.byCategoryTitle")}
            description={t("overview.byCategoryDescription")}
            emptyTitle={t("overview.none")}
            headers={[
              t("overview.categoryColumn"),
              t("overview.statusesColumn"),
              { label: t("overview.totalColumn"), align: "end" },
            ]}
            rows={overview.byCategoryAndStatus.map((item) => {
              const counts = DOCUMENT_STATUS_VALUES.flatMap((status) => {
                const count = item.countByStatus[status];
                return count ? [{ status, count }] : [];
              });
              const total = counts.reduce((sum, entry) => sum + entry.count, 0);
              return {
                id: item.category.id,
                cells: [
                  <span key="category" className="font-medium">
                    {catalogLabel(item.category, locale)}
                  </span>,
                  <span key="statuses" className="flex flex-wrap items-center gap-2">
                    {counts.map(({ status, count }) => (
                      <span key={status} className="inline-flex items-center gap-1">
                        <StatusBadge enumName="DocumentStatus" value={status} />
                        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                      </span>
                    ))}
                  </span>,
                  <span key="total" className="block text-end tabular-nums">
                    {total}
                  </span>,
                ],
              };
            })}
          />
          <RelatedMiniTable
            title={t("overview.expiringTitle")}
            description={t("overview.expiringDescription")}
            emptyTitle={t("overview.none")}
            headers={[
              t("overview.documentColumn"),
              t("overview.typeColumn"),
              t("overview.expiresColumn"),
              t("overview.statusColumn"),
            ]}
            rows={overview.expiringSoon.map((row) => ({
              id: row.id,
              cells: [
                <span key="document">{documentLabel(row)}</span>,
                <span key="type">{catalogLabel(row.type, locale)}</span>,
                row.expiresAt ? <DateText key="expires" value={row.expiresAt} /> : "—",
                <StatusBadge key="status" enumName="DocumentStatus" value={row.status} />,
              ],
            }))}
          />
          <SimpleListCard
            title={t("overview.recentTitle")}
            description={t("overview.recentDescription")}
            emptyTitle={t("overview.none")}
            rows={overview.recent.map(updatedRow)}
          />
        </>
      }
      aside={
        <>
          <SimpleListCard
            title={t("overview.staleTitle")}
            description={t("overview.staleDescription")}
            emptyTitle={t("overview.none")}
            rows={overview.staleDrafts.map(updatedRow)}
          />
          <SectionCard title={t("overview.alertsTitle")}>
            <AlertList variant="full" types={DOCUMENT_ALERT_TYPES} limit={5} />
          </SectionCard>
        </>
      }
    />
  );
}
