import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { MoneyText } from "@/components/patterns/money-text";
import { OverviewLayout } from "@/components/patterns/overview-layout";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { StatCard } from "@/components/patterns/stat-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { AlertList } from "@/features/alerts/components/alert-list";
import type { AlertType } from "@/lib/validators/alerts";
import type { ClientsOverviewDTO } from "@/lib/validators/clients";
import { CLIENT_STATUS_VALUES } from "@/lib/validators/enums";
import type { ClientScreenPermissions } from "./client-permissions";

/** Alerts a finance role sees on the clients overview (PRD §7.9, §8.2). */
const FINANCE_ALERT_TYPES: readonly AlertType[] = [
  "INVOICE_OVERDUE",
  "INVOICE_DUE_SOON",
  "UNALLOCATED_CREDIT",
];

type ClientsOverviewProps = {
  overview: ClientsOverviewDTO;
  permissions: Pick<ClientScreenPermissions, "canCreate" | "canSeeFinancials">;
};

/**
 * `/clients` (PRD §8.2 "Overview"): counts by status, the three short lists and the finance alerts. The
 * revenue, overdue and alert blocks render only for finance roles; the other roles never see their markup.
 */
export async function ClientsOverview({ overview, permissions }: ClientsOverviewProps) {
  const t = await getTranslations("clients");
  const tEnums = await getTranslations("enums");

  const recentRows = overview.recentlyCreated.map((row) => ({
    id: row.id,
    cells: [
      <EntityCodeChip key="code" code={row.code} />,
      <Link key="name" href={`/clients/${row.id}`} className="font-medium hover:underline">
        {row.tradeName}
      </Link>,
      <StatusBadge key="kind" enumName="ClientKind" value={row.kind} />,
      <StatusBadge key="status" enumName="ClientStatus" value={row.status} />,
    ],
  }));

  return (
    <OverviewLayout
      header={
        <PageHeader
          title={t("page.title")}
          description={t("page.description")}
          views={
            <OverviewTableToggle
              current="overview"
              overviewHref="/clients"
              tableHref="/clients/list"
            />
          }
          actions={
            permissions.canCreate ? (
              <Button asChild>
                <Link href="/clients/new">
                  <Plus aria-hidden />
                  {t("page.newAction")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      }
      kpis={CLIENT_STATUS_VALUES.map((status) => (
        <StatCard
          key={status}
          label={tEnums(`ClientStatus.${status}`)}
          value={overview.countByStatus[status]}
        />
      ))}
      main={
        <>
          {permissions.canSeeFinancials ? (
            <>
              <RelatedMiniTable
                title={t("overview.topRevenue")}
                headers={[t("columns.code"), t("columns.tradeName"), t("overview.collected")]}
                rows={overview.topByRevenue.map((row) => ({
                  id: row.id,
                  cells: [
                    <EntityCodeChip key="code" code={row.code} />,
                    <Link
                      key="name"
                      href={`/clients/${row.id}`}
                      className="font-medium hover:underline"
                    >
                      {row.tradeName}
                    </Link>,
                    <MoneyText key="amount" amount={row.collectedLast12MonthsUsd} currency="USD" />,
                  ],
                }))}
              />
              <RelatedMiniTable
                title={t("overview.overdue")}
                headers={[t("columns.code"), t("columns.tradeName"), t("overview.overdueUsd")]}
                rows={overview.withOverdueBalance.map((row) => ({
                  id: row.id,
                  cells: [
                    <EntityCodeChip key="code" code={row.code} />,
                    <Link
                      key="name"
                      href={`/clients/${row.id}`}
                      className="font-medium hover:underline"
                    >
                      {row.tradeName}
                    </Link>,
                    <MoneyText key="amount" amount={row.overdueUsd} currency="USD" />,
                  ],
                }))}
              />
            </>
          ) : null}
          <RelatedMiniTable
            title={t("overview.recent")}
            headers={[
              t("columns.code"),
              t("columns.tradeName"),
              t("columns.kind"),
              t("columns.status"),
            ]}
            rows={recentRows}
          />
        </>
      }
      aside={
        permissions.canSeeFinancials ? (
          <section aria-label={t("overview.alerts")} className="space-y-3">
            <h2 className="text-base font-semibold">{t("overview.alerts")}</h2>
            <AlertList variant="full" types={FINANCE_ALERT_TYPES} limit={5} />
          </section>
        ) : undefined
      }
    />
  );
}
