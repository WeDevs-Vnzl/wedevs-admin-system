"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { formatMoney } from "@/lib/money";
import type { KpiUnit } from "@/lib/validators/dashboard";
import type { ColumnKind, SectionColumn } from "../report-sections";

const EMPTY = "—";

/** Display formatting of the report screens: USD amounts, KPI units, months and table headers. */
export function useReportFormat() {
  const t = useTranslations("reports");
  const locale = useLocale();
  const format = useFormatter();

  const number = useCallback(
    (value: string) => format.number(Number(value), { maximumFractionDigits: 2 }),
    [format],
  );

  const month = useCallback(
    (period: string) => {
      const [year, index] = period.split("-").map(Number) as [number, number];
      return format.dateTime(new Date(Date.UTC(year, index - 1, 1)), {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    },
    [format],
  );

  const kpiValue = useCallback(
    (unit: KpiUnit, value: string | null) => {
      if (value === null) return t("kpi.noData");
      if (unit === "USD") return formatMoney(value, "USD", locale);
      return t(`units.${unit}`, { value: number(value) });
    },
    [locale, number, t],
  );

  const cell = useCallback(
    (kind: ColumnKind, value: string | null) => {
      if (value === null) return EMPTY;
      switch (kind) {
        case "money":
          return formatMoney(value, "USD", locale);
        case "percent":
          return t("units.PERCENT", { value: number(value) });
        case "number":
          return number(value);
        case "month":
          return month(value);
        case "rate":
          return t("taxes.rate", { rate: number(value) });
        case "key":
          return t.has(`breakdown.${value}`) ? t(`breakdown.${value}`) : value;
        case "text":
          return value;
      }
    },
    [locale, month, number, t],
  );

  const header = useCallback(
    (column: SectionColumn) => {
      if (column.rate !== undefined) return t("taxes.rate", { rate: number(column.rate) });
      return column.header ?? t(`columns.${column.key}`);
    },
    [number, t],
  );

  return useMemo(() => ({ kpiValue, cell, header, number }), [kpiValue, cell, header, number]);
}
