import type { KpisResponseDto, ReportResponseDto } from "@/lib/api/types/intel";
import { KPI_ID_VALUES, KPI_UNITS, type KpiId, type ReportId } from "@/lib/validators/reports";

// TEST FIXTURE: synthetic `GET /api/v1/reports/kpis` bodies for the HTTP-mocked tests (no customer data, no mock
// service). Values are decimal strings, as the contract sends them (C15); one KPI has no data (`null`).

/** The 12 months ending at `lastMonth` (`YYYY-MM`), oldest first. */
function monthsEndingAt(lastMonth: string): string[] {
  const [year, month] = lastMonth.split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (11 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

function card(id: KpiId, index: number, lastMonth: string): KpisResponseDto["kpis"][number] {
  const hasChange = index % 2 === 0;
  const card: KpisResponseDto["kpis"][number] = {
    id,
    unit: KPI_UNITS[id],
    value: id === "DSO" ? null : `${1000 + index}.00`,
    previousValue: hasChange ? `${900 + index}.00` : null,
    changePercent: hasChange ? "12.50" : null,
    sparkline: monthsEndingAt(lastMonth).map((period, point) => ({
      period,
      value: `${100 + point + index}.00`,
    })),
  };
  if (id === "STACK_USAGE") {
    card.breakdown = [{ key: "typescript", label: "TypeScript", value: "3" }];
  }
  return card;
}

/** The eighteen KPIs of a range whose last sparkline month is `lastMonth` (default `2026-10`). */
export function makeKpisResponse(lastMonth = "2026-10"): KpisResponseDto {
  return {
    range: { dateFrom: "2025-11-01", dateTo: "2026-10-31" },
    previousRange: { dateFrom: "2024-11-01", dateTo: "2025-10-31" },
    kpis: KPI_ID_VALUES.map((id, index) => card(id, index, lastMonth)),
  };
}

const RANGE = { dateFrom: "2025-11-01", dateTo: "2026-10-31" };
const MONTHS = ["2026-09", "2026-10"];
const ENTITY_CLIENT = {
  type: "CLIENT" as const,
  id: "cli_kairos",
  label: "Kairos Studio LLC",
  code: "CLI-0001",
};
const ENTITY_PROJECT = {
  type: "PROJECT" as const,
  id: "pry_app",
  label: "App Delivery Kairos",
  code: "PRY-0003",
};
const ENTITY_ACCOUNT = {
  type: "ACCOUNT" as const,
  id: "acc_bank",
  label: "Banco de prueba",
  code: null,
};
const AGING = { d0_30: "100.00", d31_60: "0.00", d61_90: "0.00", d90plus: "0.00" };
const IVA = [{ ivaRate: "16", taxBase: "1000.00", ivaAmount: "160.00" }];
const TAX_MONTH = {
  period: "2026-10",
  ivaByRate: IVA,
  ivaTotal: "160.00",
  ivaWithheld: "0.00",
  islrWithheld: "0.00",
  otherWithheld: "0.00",
  igtf: "0.00",
};
const TAX_TOTALS = {
  ivaByRate: IVA,
  ivaTotal: "160.00",
  ivaWithheld: "0.00",
  islrWithheld: "0.00",
  otherWithheld: "0.00",
  igtf: "0.00",
};
const CHART = {
  periods: MONTHS,
  series: [
    { id: "billed", values: ["900.00", "1000.00"] },
    { id: "collected", values: ["800.00", "700.00"] },
  ],
};

/**
 * One financial report as the BE sends it, for the HTTP-mocked tests. A project margin is `null` when nothing is
 * collected, as the BE sends it under a client filter (DT-176).
 */
export function makeReportResponse(id: ReportId): ReportResponseDto {
  const currency = "USD" as const;
  switch (id) {
    case "COLLECTED_BY_MONTH":
      return {
        reportId: id,
        currency,
        range: RANGE,
        points: [{ period: "2026-10", value: "700.00" }],
      };
    case "BILLED_VS_COLLECTED":
      return { reportId: id, currency, range: RANGE, chart: CHART };
    case "REVENUE_BY_CLIENT":
      return {
        reportId: id,
        currency,
        range: RANGE,
        rows: [{ client: ENTITY_CLIENT, collected: "700.00", billed: "1000.00" }],
      };
    case "REVENUE_BY_PROJECT":
      return {
        reportId: id,
        currency,
        range: RANGE,
        rows: [
          {
            project: ENTITY_PROJECT,
            collected: "700.00",
            margin: "300.00",
            marginPercent: "42.86",
          },
          {
            project: { ...ENTITY_PROJECT, id: "pry_none", label: "Sin cobros" },
            collected: "0.00",
            margin: null,
            marginPercent: null,
          },
        ],
      };
    case "RECEIVABLES_AGING":
      return {
        reportId: id,
        currency,
        range: RANGE,
        rows: [{ client: ENTITY_CLIENT, buckets: AGING, total: "100.00" }],
        totals: AGING,
      };
    case "EXPENSES_BY_MONTH_CATEGORY":
      return { reportId: id, currency, range: RANGE, chart: CHART };
    case "NET_RESULT_MONTHLY":
      return {
        reportId: id,
        currency,
        range: RANGE,
        points: [
          { period: "2026-09", value: null },
          { period: "2026-10", value: "-120.00" },
        ],
      };
    case "ACCOUNT_FLOW":
      return {
        reportId: id,
        currency,
        range: RANGE,
        rows: [{ account: ENTITY_ACCOUNT, period: "2026-10", inflow: "50.00", outflow: "20.00" }],
      };
    case "COLLECTIONS_BY_METHOD":
      return {
        reportId: id,
        currency,
        range: RANGE,
        rows: [
          { methodId: "pm_transfer", methodCode: "TRANSFER", collected: "700.00", share: "100.00" },
        ],
      };
    case "TAXES_REGISTERED":
      return {
        reportId: id,
        currency,
        range: RANGE,
        months: [{ ...TAX_MONTH }],
        totals: TAX_TOTALS,
      };
  }
}
