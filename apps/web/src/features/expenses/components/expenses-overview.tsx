import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarDays, Plus, Repeat, Tags, Wallet } from "lucide-react";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { OverviewLayout } from "@/components/patterns/overview-layout";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { SectionCard } from "@/components/patterns/section-card";
import { ListCode, SimpleListCard } from "@/components/patterns/simple-list-card";
import { StatCard } from "@/components/patterns/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertList } from "@/features/alerts/components/alert-list";
import type { AlertType } from "@/lib/validators/alerts";
import type { ExpensesOverviewDTO } from "@/lib/validators/expenses";
import { sumMoney, toDecimal } from "@/lib/money";
import type { expenseScreenPermissions } from "../permissions";

/** Alerts of this module shown in the overview aside (PRD §7.9). */
const EXPENSE_ALERT_TYPES: readonly AlertType[] = ["RECURRING_EXPENSE_PENDING"];

type ExpensesOverviewProps = {
  overview: ExpensesOverviewDTO;
  permissions: ReturnType<typeof expenseScreenPermissions>;
};

/** A money cell aligned to the end of its column, with tabular figures. */
function EndMoney({ amount }: { amount: string }) {
  return (
    <div className="text-end tabular-nums">
      <MoneyText amount={amount} currency="USD" />
    </div>
  );
}

/**
 * `/expenses` overview (DT-25, PRD §8.8) on the module overview pattern: KPIs (committed monthly recurring spend,
 * this month's and the six-month paid spend, the top category), spend per category and per month (USD, last six
 * months) and, aside, the upcoming pending expenses and the recurring-expense alerts. The list lives on
 * `/expenses/list`.
 */
export async function ExpensesOverview({ overview, permissions }: ExpensesOverviewProps) {
  const t = await getTranslations("expenses");
  const tPatterns = await getTranslations("patterns.relatedTable");
  const { periods, series } = overview.byMonthAndCategory;

  const sixMonthTotal = sumMoney(overview.byCategory.map((item) => item.value));
  const thisMonth = sumMoney(series.map((item) => item.values[periods.length - 1] ?? "0"));
  const top = [...overview.byCategory].sort((a, b) =>
    toDecimal(b.value).comparedTo(toDecimal(a.value)),
  )[0];
  const shareOf = (value: string) =>
    toDecimal(sixMonthTotal).isZero()
      ? "0%"
      : `${toDecimal(value).div(sixMonthTotal).mul(100).toFixed(1)}%`;

  return (
    <OverviewLayout
      header={
        <PageHeader
          title={t("page.overviewTitle")}
          description={t("page.description")}
          views={
            <OverviewTableToggle
              current="overview"
              overviewHref="/expenses"
              tableHref="/expenses/list"
            />
          }
          actions={
            permissions.canCreate ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <Link href="/expenses/recurring">
                    <Repeat aria-hidden />
                    {t("page.recurringAction")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/expenses/new">
                    <Plus aria-hidden />
                    {t("page.newAction")}
                  </Link>
                </Button>
              </div>
            ) : undefined
          }
        />
      }
      kpis={
        <>
          <StatCard
            label={t("overview.committedTitle")}
            value={<MoneyText amount={overview.committedMonthly} currency="USD" />}
            hint={t("overview.committedHint")}
            icon={Repeat}
          />
          <StatCard
            label={t("overview.thisMonthTitle")}
            value={<MoneyText amount={thisMonth} currency="USD" />}
            hint={periods[periods.length - 1]}
            icon={CalendarDays}
          />
          <StatCard
            label={t("overview.sixMonthsTitle")}
            value={<MoneyText amount={sixMonthTotal} currency="USD" />}
            hint={t("overview.sixMonthsHint")}
            icon={Wallet}
          />
          <StatCard
            label={t("overview.topCategoryTitle")}
            value={top ? <MoneyText amount={top.value} currency="USD" /> : "—"}
            hint={top ? (top.label ?? top.key) : t("overview.noSpend")}
            icon={Tags}
          />
        </>
      }
      main={
        <>
          <SimpleListCard
            title={t("overview.byCategoryTitle")}
            emptyTitle={tPatterns("empty")}
            rows={overview.byCategory.map((item) => ({
              id: item.key,
              label: <span className="font-medium">{item.label ?? item.key}</span>,
              values: [
                { node: <MoneyText amount={item.value} currency="USD" /> },
                {
                  node: (
                    <span className="inline-block w-14 text-muted-foreground">
                      {shareOf(item.value)}
                    </span>
                  ),
                },
              ],
            }))}
          />
          <RelatedMiniTable
            title={t("overview.byMonthTitle")}
            headers={[
              t("overview.categoryColumn"),
              ...periods.map((period) => ({ label: period, align: "end" as const })),
            ]}
            rows={series.map((item) => ({
              id: item.id,
              cells: [
                <span key="category" className="font-medium">
                  {item.label ?? item.id}
                </span>,
                ...item.values.map((value, index) => (
                  <EndMoney key={periods[index] ?? index} amount={value} />
                )),
              ],
            }))}
          />
        </>
      }
      aside={
        <>
          <SimpleListCard
            title={t("overview.upcomingTitle")}
            emptyTitle={tPatterns("empty")}
            rows={overview.upcoming.map((row) => ({
              id: row.id,
              label: (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <ListCode
                    href={`/expenses/${row.id}`}
                    code={row.code}
                    name={row.vendor ?? row.description}
                  />
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {row.dueDate ? <DateText value={row.dueDate} /> : "—"}
                    {row.overdue ? (
                      <Badge variant="destructive">{t("status.overdue")}</Badge>
                    ) : null}
                  </span>
                </span>
              ),
              values: [{ node: <MoneyText amount={row.amountUsd} currency="USD" /> }],
            }))}
          />
          <SectionCard title={t("overview.alertsTitle")}>
            <AlertList variant="full" types={EXPENSE_ALERT_TYPES} limit={5} />
          </SectionCard>
        </>
      }
    />
  );
}
