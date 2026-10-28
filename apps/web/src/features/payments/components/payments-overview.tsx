import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { MoneyText } from "@/components/patterns/money-text";
import { OverviewLayout } from "@/components/patterns/overview-layout";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { ListCode, SimpleListCard } from "@/components/patterns/simple-list-card";
import { StatCard } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import type { PaymentListRow, PaymentsOverviewDTO } from "@/lib/validators/payments";

type PaymentsOverviewProps = {
  overview: PaymentsOverviewDTO;
  /** Latest confirmed payments with a credit balance left to apply (already limited by the page). */
  withCredit: PaymentListRow[];
  canCreate: boolean;
};

/**
 * `/payments` overview (DT-25, not the list), on the module overview pattern: the attention counters, the
 * monthly collection in USD (months with collections only), the breakdowns by method and by account, and the
 * payments that still carry credit for the client (HU-13 CA5).
 */
export async function PaymentsOverview({ overview, withCredit, canCreate }: PaymentsOverviewProps) {
  const t = await getTranslations("payments");
  const tPatterns = await getTranslations("patterns.relatedTable");
  const locale = await getLocale();
  const monthFormat = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Newest month first; months without collections add rows and no information.
  const collectedRows = overview.collectedByMonth
    .filter((point) => Number(point.value) > 0)
    .reverse()
    .map((point) => ({
      id: point.period,
      label: (
        <span className="capitalize">
          {monthFormat.format(new Date(`${point.period}-01T00:00:00Z`))}
        </span>
      ),
      values: [{ node: <MoneyText amount={point.value} currency="USD" /> }],
    }));

  const breakdownRows = (items: PaymentsOverviewDTO["byMethod"]) =>
    items.map((item) => ({
      id: item.key,
      label: item.label ?? item.key,
      values: [{ node: <MoneyText amount={item.value} currency="USD" /> }],
    }));

  return (
    <OverviewLayout
      header={
        <PageHeader
          title={t("page.overviewTitle")}
          description={t("page.description")}
          views={
            <OverviewTableToggle
              current="overview"
              overviewHref="/payments"
              tableHref="/payments/list"
            />
          }
          actions={
            canCreate ? (
              <Button asChild>
                <Link href="/payments/new">
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
            label={t("overview.pendingVerification")}
            value={overview.pendingVerificationCount}
          />
          <StatCard label={t("overview.unallocated")} value={overview.unallocatedCount} />
          <StatCard
            label={t("overview.unallocatedTotal")}
            value={<MoneyText amount={overview.unallocatedTotalUsd} currency="USD" />}
          />
        </>
      }
      main={
        <div className="grid items-start gap-6 md:grid-cols-2">
          <SimpleListCard
            title={t("overview.collectedTitle")}
            emptyTitle={tPatterns("empty")}
            rows={collectedRows}
          />
          <div className="flex flex-col gap-6">
            <SimpleListCard
              title={t("overview.byMethod")}
              emptyTitle={tPatterns("empty")}
              rows={breakdownRows(overview.byMethod)}
            />
            <SimpleListCard
              title={t("overview.byAccount")}
              emptyTitle={tPatterns("empty")}
              rows={breakdownRows(overview.byAccount)}
            />
          </div>
        </div>
      }
      aside={
        <SimpleListCard
          title={t("overview.withCredit")}
          emptyTitle={tPatterns("empty")}
          rows={withCredit.map((row) => ({
            id: row.id,
            label: (
              <ListCode href={`/payments/${row.id}`} code={row.code} name={row.client.label} />
            ),
            values: [{ node: <MoneyText amount={row.unallocated} currency={row.currency} /> }],
          }))}
        />
      }
    />
  );
}
