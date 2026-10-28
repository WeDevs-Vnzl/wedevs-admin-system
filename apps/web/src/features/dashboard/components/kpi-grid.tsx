"use client";

import { useLocale, useTranslations } from "next-intl";
import { KpiCard } from "@/components/patterns/kpi-card";
import { MoneyText } from "@/components/patterns/money-text";
import { formatMoney, isNegativeMoney, isZeroMoney } from "@/lib/money";
import type { DashboardKpiId, KpiCardDTO } from "@/lib/validators/dashboard";
import type { DashboardPeriod } from "../period";

/** The one card a Member or Viewer keeps: every other card is financial data (PRD §11). */
const NON_FINANCIAL_KPIS = new Set<DashboardKpiId>(["ACTIVE_PROJECTS"]);

/** Cards shown to the viewer, in display order. */
export function visibleKpis(kpis: readonly KpiCardDTO[], showFinancials: boolean): KpiCardDTO[] {
  return showFinancials ? [...kpis] : kpis.filter((card) => NON_FINANCIAL_KPIS.has(card.id));
}

/** `25.00` → `+25 %` in the locale (display only; the figure stays a decimal string). */
export function formatChange(changePercent: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(Number(changePercent) / 100);
}

function KpiValue({ card }: { card: KpiCardDTO }) {
  const t = useTranslations("dashboard.kpis");
  const locale = useLocale();
  if (card.unit !== "USD") return <>{card.value}</>;
  return (
    <>
      <MoneyText amount={card.value} currency="USD" />
      {card.secondaryValue !== null ? (
        <span className="mt-1 block text-xs font-normal text-destructive">
          {t("overdue", { amount: formatMoney(card.secondaryValue, "USD", locale) })}
        </span>
      ) : null}
    </>
  );
}

type KpiGridProps = {
  kpis: readonly KpiCardDTO[];
  period: DashboardPeriod;
  showFinancials: boolean;
};

/** The KPI cards of PRD §8.1, each with its comparison against the previous period when there is one. */
export function KpiGrid({ kpis, period, showFinancials }: KpiGridProps) {
  const t = useTranslations("dashboard.kpis");
  const locale = useLocale();

  const variation = (card: KpiCardDTO) => {
    if (card.previousValue === null) return undefined;
    if (card.changePercent === null) {
      const previous =
        card.unit === "USD" ? formatMoney(card.previousValue, "USD", locale) : card.previousValue;
      return { label: t("previousZero", { amount: previous, period }), direction: "flat" as const };
    }
    const direction = isZeroMoney(card.changePercent)
      ? ("flat" as const)
      : isNegativeMoney(card.changePercent)
        ? ("down" as const)
        : ("up" as const);
    return {
      label: t("change", { percent: formatChange(card.changePercent, locale), period }),
      direction,
    };
  };

  return (
    <section aria-label={t("label")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {visibleKpis(kpis, showFinancials).map((card) => (
        <KpiCard
          key={card.id}
          label={t(card.id, { period })}
          value={<KpiValue card={card} />}
          variation={variation(card)}
        />
      ))}
    </section>
  );
}
