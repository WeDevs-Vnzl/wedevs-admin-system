import type { KpiResultDTO, ReportResult } from "@/lib/validators/reports";

// Turns a report or KPI result into the sections the detail page draws: each section is one chart plus the data
// table and CSV behind it (PRD §8.13 "Cada gráfico tiene una tabla de datos desplegable y exportación a CSV").
// Pure: headers are i18n keys of the `reports` namespace (`columns.*`) or user data (`header`); cells stay raw
// decimal strings and month keys, formatted by the view.

/** `rate`: a VAT rate cell ("IVA 16 %"); `key`: a breakdown key, translated under `breakdown.*` when known. */
export type ColumnKind = "text" | "key" | "month" | "money" | "percent" | "number" | "rate";

export interface SectionColumn {
  key: string;
  kind: ColumnKind;
  /** User data (a category name); otherwise the header is `columns.<key>`. */
  header?: string;
  /** The VAT rate of an "IVA per rate" column; its header reads `taxes.rate`. */
  rate?: string;
}

export type SectionRow = Record<string, string | null>;

export interface ReportSection {
  key: string;
  /** i18n key of the section title (namespace `reports`). */
  titleKey: string;
  chart: "bar" | "stacked" | "line";
  /** Column on the chart's category axis; the series are `series`. */
  category: string;
  series: string[];
  columns: SectionColumn[];
  rows: SectionRow[];
}

const col = (key: string, kind: ColumnKind, header?: string): SectionColumn =>
  header === undefined ? { key, kind } : { key, kind, header };

const AGING = ["d0_30", "d31_60", "d61_90", "d90plus"] as const;
const WITHHOLDINGS = ["ivaWithheld", "islrWithheld", "otherWithheld", "igtf"] as const;

function single(
  titleKey: string,
  chart: ReportSection["chart"],
  columns: SectionColumn[],
  rows: SectionRow[],
  series: string[],
): ReportSection[] {
  return [
    {
      key: "main",
      titleKey,
      chart,
      category: columns[0]!.key,
      series,
      columns,
      rows,
    },
  ];
}

/** Sections of one of the ten financial reports. */
export function reportSections(result: ReportResult): ReportSection[] {
  const title = `items.reports.${result.reportId}.title`;
  switch (result.reportId) {
    case "COLLECTED_BY_MONTH":
      return single(
        title,
        "bar",
        [col("period", "month"), col("collected", "money")],
        result.points.map((point) => ({ period: point.period, collected: point.value })),
        ["collected"],
      );
    case "NET_RESULT_MONTHLY":
      return single(
        title,
        "bar",
        [col("period", "month"), col("net", "money")],
        result.points.map((point) => ({ period: point.period, net: point.value })),
        ["net"],
      );
    case "BILLED_VS_COLLECTED":
    case "EXPENSES_BY_MONTH_CATEGORY": {
      const { periods, series } = result.chart;
      const keyOf = (index: number) => `s${index}`;
      const columns = [
        col("period", "month"),
        ...series.map((serie, index) =>
          result.reportId === "BILLED_VS_COLLECTED"
            ? col(serie.id, "money")
            : col(keyOf(index), "money", serie.label ?? serie.id),
        ),
      ];
      const rows = periods.map((period, row) => {
        const cells: SectionRow = { period };
        series.forEach((serie, index) => {
          cells[columns[index + 1]!.key] = serie.values[row] ?? null;
        });
        return cells;
      });
      return single(
        title,
        result.reportId === "BILLED_VS_COLLECTED" ? "bar" : "stacked",
        columns,
        rows,
        columns.slice(1).map((column) => column.key),
      );
    }
    case "REVENUE_BY_CLIENT":
      return single(
        title,
        "bar",
        [col("client", "text"), col("collected", "money"), col("billed", "money")],
        result.rows.map((row) => ({
          client: row.client.label,
          collected: row.collected,
          billed: row.billed,
        })),
        ["collected", "billed"],
      );
    case "REVENUE_BY_PROJECT":
      return single(
        title,
        "bar",
        [
          col("project", "text"),
          col("collected", "money"),
          col("margin", "money"),
          col("marginPercent", "percent"),
        ],
        result.rows.map((row) => ({
          project: row.project.label,
          collected: row.collected,
          margin: row.margin,
          marginPercent: row.marginPercent,
        })),
        ["collected", "margin"],
      );
    case "RECEIVABLES_AGING":
      return single(
        title,
        "stacked",
        [col("client", "text"), ...AGING.map((key) => col(key, "money")), col("total", "money")],
        result.rows.map((row) => ({ client: row.client.label, ...row.buckets, total: row.total })),
        [...AGING],
      );
    case "ACCOUNT_FLOW":
      return single(
        title,
        "bar",
        [
          col("account", "text"),
          col("period", "month"),
          col("inflow", "money"),
          col("outflow", "money"),
        ],
        result.rows.map((row) => ({
          account: row.account.label,
          period: row.period,
          inflow: row.inflow,
          outflow: row.outflow,
        })),
        ["inflow", "outflow"],
      );
    case "COLLECTIONS_BY_METHOD":
      return single(
        title,
        "bar",
        [col("method", "text"), col("collected", "money"), col("share", "percent")],
        result.rows.map((row) => ({
          method: row.methodCode,
          collected: row.collected,
          share: row.share,
        })),
        ["collected"],
      );
    case "TAXES_REGISTERED": {
      // IVA per rate (DT-44): one column per VAT rate seen in the range, then withholdings and IGTF.
      const rates = [
        ...new Set(result.months.flatMap((month) => month.ivaByRate.map((row) => row.ivaRate))),
      ].sort((a, b) => Number(b) - Number(a));
      const rateKey = (index: number) => `rate${index}`;
      const monthly: ReportSection = {
        key: "main",
        titleKey: title,
        chart: "stacked",
        category: "period",
        series: ["ivaTotal", ...WITHHOLDINGS],
        columns: [
          col("period", "month"),
          ...rates.map((rate, index) => ({ key: rateKey(index), kind: "money" as const, rate })),
          col("ivaTotal", "money"),
          ...WITHHOLDINGS.map((key) => col(key, "money")),
        ],
        rows: result.months.map((month) => {
          const cells: SectionRow = { period: month.period, ivaTotal: month.ivaTotal };
          rates.forEach((rate, index) => {
            cells[rateKey(index)] =
              month.ivaByRate.find((row) => row.ivaRate === rate)?.ivaAmount ?? "0.00";
          });
          for (const key of WITHHOLDINGS) cells[key] = month[key];
          return cells;
        }),
      };
      const byRate: ReportSection = {
        key: "byRate",
        titleKey: "taxes.byRate",
        chart: "bar",
        category: "ivaRate",
        series: ["ivaAmount"],
        columns: [col("ivaRate", "rate"), col("taxBase", "money"), col("ivaAmount", "money")],
        rows: result.totals.ivaByRate.map((row) => ({ ...row })),
      };
      return [monthly, byRate];
    }
  }
}

/** Sections of a KPI: its 12-month series and, when the KPI has one, its breakdown. */
export function kpiSections(result: KpiResultDTO): ReportSection[] {
  const numeric: ColumnKind =
    result.unit === "USD" ? "money" : result.unit === "PERCENT" ? "percent" : "number";
  const sections: ReportSection[] = [
    {
      key: "sparkline",
      titleKey: "kpi.sparkline",
      chart: "line",
      category: "period",
      series: ["value"],
      columns: [col("period", "month"), col("value", numeric)],
      rows: result.sparkline.map((point) => ({ period: point.period, value: point.value })),
    },
  ];
  if (result.breakdown?.length) {
    sections.push({
      key: "breakdown",
      titleKey: "kpi.breakdown",
      chart: "bar",
      category: "item",
      series: ["value"],
      columns: [col("item", "key"), col("value", numeric)],
      rows: result.breakdown.map((row) => ({ item: row.label ?? row.key, value: row.value })),
    });
  }
  return sections;
}
