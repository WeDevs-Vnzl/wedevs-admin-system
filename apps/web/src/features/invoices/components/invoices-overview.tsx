import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { MoneyText } from "@/components/patterns/money-text";
import { OverviewLayout } from "@/components/patterns/overview-layout";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { SimpleListCard } from "@/components/patterns/simple-list-card";
import { StatCard } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import { AlertList } from "@/features/alerts/components/alert-list";
import { formatMoney } from "@/lib/money";
import type { AlertType } from "@/lib/validators/alerts";
import type { InvoicesOverviewDTO } from "@/lib/validators/invoices";

/** The invoice alerts shown beside the overview (PRD §7.9). */
const INVOICE_ALERT_TYPES: readonly AlertType[] = ["INVOICE_OVERDUE", "INVOICE_DUE_SOON"];

const AGING_KEYS = ["d0_30", "d31_60", "d61_90", "d90plus"] as const;

type InvoicesOverviewProps = {
  overview: InvoicesOverviewDTO;
  canCreate: boolean;
};

/**
 * `/invoices` overview (DT-25) on the module overview pattern: the overdue count and the open receivable per
 * currency as KPIs, the billed-against-collected trend and the USD aging as simple lists, and the invoice alerts aside.
 * It is a summary; the table of invoices lives on `/invoices/list`.
 */
export async function InvoicesOverview({ overview, canCreate }: InvoicesOverviewProps) {
  const t = await getTranslations("invoices");
  const locale = await getLocale();
  const series = Object.fromEntries(
    overview.billedVsCollected.series.map((item) => [item.id, item.values]),
  );

  const receivableKpis =
    overview.totalsByCurrency.length === 0
      ? [
          <StatCard
            key="receivable"
            label={t("overview.openTitle")}
            value={<MoneyText amount="0.00" currency="USD" />}
            hint={t("overview.none")}
          />,
        ]
      : overview.totalsByCurrency.map((row) => (
          <StatCard
            key={row.currency}
            label={t("overview.openKpi", { currency: row.currency })}
            value={<MoneyText amount={row.balance} currency={row.currency} />}
            hint={t("overview.overdueAmount", {
              amount: formatMoney(row.overdue, row.currency, locale),
            })}
          />
        ));

  return (
    <OverviewLayout
      header={
        <PageHeader
          title={t("page.overviewTitle")}
          description={t("page.overviewDescription")}
          views={
            <OverviewTableToggle
              current="overview"
              overviewHref="/invoices"
              tableHref="/invoices/list"
            />
          }
          actions={
            canCreate ? (
              <Button asChild>
                <Link href="/invoices/new">
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
          <StatCard
            label={t("overview.overdueTitle")}
            value={overview.overdueCount}
            hint={t("overview.overdueDescription")}
          />
          {receivableKpis}
        </>
      }
      main={
        <div className="grid gap-6 md:grid-cols-2">
          <SimpleListCard
            title={t("overview.trendTitle")}
            description={t("overview.trendDescription")}
            emptyTitle={t("overview.none")}
            rows={overview.billedVsCollected.periods.map((period, index) => ({
              id: period,
              label: <span className="tabular-nums">{period}</span>,
              values: [
                {
                  label: t("overview.trend.billed"),
                  node: <MoneyText amount={series.billed?.[index] ?? "0.00"} currency="USD" />,
                },
                {
                  label: t("overview.trend.collected"),
                  node: <MoneyText amount={series.collected?.[index] ?? "0.00"} currency="USD" />,
                },
              ],
            }))}
          />
          <SimpleListCard
            title={t("overview.agingTitle")}
            description={t("overview.agingDescription")}
            emptyTitle={t("overview.none")}
            rows={AGING_KEYS.map((key) => ({
              id: key,
              label: t(`overview.aging.${key}`),
              values: [{ node: <MoneyText amount={overview.aging[key]} currency="USD" /> }],
            }))}
          />
        </div>
      }
      aside={
        <SectionCard title={t("overview.alerts")}>
          <AlertList variant="full" types={INVOICE_ALERT_TYPES} limit={5} />
        </SectionCard>
      }
    />
  );
}
