import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/reports.json";
import es from "@/i18n/messages/es/reports.json";
import { KPI_UNIT_VALUES } from "./dashboard";
import {
  KPI_ID_VALUES,
  KPI_UNITS,
  REPORT_ID_VALUES,
  REPORT_MESSAGES,
  getKpiInputSchema,
  getReportInputSchema,
  kpiResultDtoSchema,
  reportFilterSchema,
  reportIdSchema,
  reportResultSchema,
  taxesRegisteredReportSchema,
  type ReportsService,
} from "./reports";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

function hasKey(catalog: unknown, path: string[]): boolean {
  let node: unknown = catalog;
  for (const part of path) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" && node.length > 0;
}

const ref = (id: string, type: "CLIENT" | "PROJECT" | "ACCOUNT") => ({ id, label: id, type });
const range = { dateFrom: "2025-10-01", dateTo: "2026-09-30" };
const base = { currency: "USD", range };
const buckets = { d0_30: "1.00", d31_60: "2.00", d61_90: "3.00", d90plus: "4.00" };

describe("report message keys", () => {
  it("exist in the reports namespace for es and en", () => {
    for (const key of Object.values(REPORT_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("report and KPI ids", () => {
  it("lists the ten financial reports and eighteen KPIs of §8.13", () => {
    expect(REPORT_ID_VALUES).toHaveLength(10);
    expect(KPI_ID_VALUES).toHaveLength(18);
    expect(reportIdSchema.safeParse("TAXES_REGISTERED").success).toBe(true);
    expect(reportIdSchema.safeParse("PROFIT_LOSS").success).toBe(false);
  });

  it("every KPI has a known unit", () => {
    for (const id of KPI_ID_VALUES) expect(KPI_UNIT_VALUES).toContain(KPI_UNITS[id]);
    expect(KPI_UNITS.RUNWAY).toBe("MONTHS");
    expect(KPI_UNITS.DSO).toBe("DAYS");
  });
});

describe("report filters", () => {
  it("defaults to the last 12 months", () => {
    expect(reportFilterSchema.parse({}).preset).toBe("LAST_12_MONTHS");
  });

  it("accepts the presets plus client, project and tag", () => {
    for (const preset of ["THIS_MONTH", "PREVIOUS_MONTH", "QUARTER", "YEAR", "LAST_12_MONTHS"]) {
      expect(reportFilterSchema.safeParse({ preset }).success, preset).toBe(true);
    }
    expect(
      reportFilterSchema.safeParse({ preset: "YEAR", clientId: "c1", projectId: "p1", tagId: "t1" })
        .success,
    ).toBe(true);
    expect(reportFilterSchema.safeParse({ preset: "DECADE" }).success).toBe(false);
  });

  it("a custom range needs both dates, in order", () => {
    expect(messages(reportFilterSchema.safeParse({ preset: "CUSTOM" }))).toEqual([
      REPORT_MESSAGES.customRangeRequired,
      REPORT_MESSAGES.customRangeRequired,
    ]);
    expect(
      messages(
        reportFilterSchema.safeParse({
          preset: "CUSTOM",
          dateFrom: "2026-10-02",
          dateTo: "2026-10-01",
        }),
      ),
    ).toContain(REPORT_MESSAGES.rangeInverted);
    expect(
      reportFilterSchema.safeParse({
        preset: "CUSTOM",
        dateFrom: "2026-10-01",
        dateTo: "2026-10-01",
      }).success,
    ).toBe(true);
    expect(
      reportFilterSchema.safeParse({
        preset: "CUSTOM",
        dateFrom: "2026-02-30",
        dateTo: "2026-03-01",
      }).success,
    ).toBe(false);
  });

  it("report and KPI inputs pair an id with a filter", () => {
    expect(getReportInputSchema.safeParse({ id: "TAXES_REGISTERED", filter: {} }).success).toBe(
      true,
    );
    expect(getReportInputSchema.safeParse({ id: "NOPE", filter: {} }).success).toBe(false);
    expect(getKpiInputSchema.safeParse({ id: "MRR", filter: { preset: "YEAR" } }).success).toBe(
      true,
    );
  });
});

describe("taxes registered report (IVA per rate)", () => {
  const period = {
    ivaByRate: [
      { ivaRate: "16", taxBase: "1000.00", ivaAmount: "160.00" },
      { ivaRate: "8", taxBase: "500.00", ivaAmount: "40.00" },
      { ivaRate: "0", taxBase: "200.00", ivaAmount: "0.00" },
    ],
    ivaTotal: "200.00",
    ivaWithheld: "120.00",
    islrWithheld: "10.00",
    otherWithheld: "0.00",
    igtf: "15.00",
  };
  const report = {
    ...base,
    reportId: "TAXES_REGISTERED",
    months: [{ period: "2026-09", ...period }],
    totals: period,
  };

  it("carries IVA per rate, withholdings and IGTF", () => {
    const parsed = taxesRegisteredReportSchema.parse(report);
    expect(parsed.months[0]?.ivaByRate.map((row) => row.ivaRate)).toEqual(["16", "8", "0"]);
    expect(reportResultSchema.safeParse(report).success).toBe(true);
  });

  it("rejects numbers, negative amounts and an out-of-range rate", () => {
    const row = (overrides: object) => ({
      ...report,
      totals: { ...period, ivaByRate: [{ ...period.ivaByRate[0], ...overrides }] },
    });
    expect(taxesRegisteredReportSchema.safeParse(row({ ivaAmount: 160 })).success).toBe(false);
    expect(taxesRegisteredReportSchema.safeParse(row({ ivaAmount: "-1.00" })).success).toBe(false);
    expect(taxesRegisteredReportSchema.safeParse(row({ ivaRate: "116" })).success).toBe(false);
    expect(
      taxesRegisteredReportSchema.safeParse({ ...report, totals: { ...period, igtf: 15 } }).success,
    ).toBe(false);
  });
});

describe("report results", () => {
  const results = [
    { ...base, reportId: "COLLECTED_BY_MONTH", points: [{ period: "2026-09", value: "100.00" }] },
    {
      ...base,
      reportId: "BILLED_VS_COLLECTED",
      chart: { periods: ["2026-09"], series: [{ id: "billed", values: ["100.00"] }] },
    },
    {
      ...base,
      reportId: "REVENUE_BY_CLIENT",
      rows: [{ client: ref("c1", "CLIENT"), collected: "10.00", billed: "20.00" }],
    },
    {
      ...base,
      reportId: "REVENUE_BY_PROJECT",
      rows: [
        { project: ref("p1", "PROJECT"), collected: "10.00", margin: "-2.00", marginPercent: null },
      ],
    },
    {
      ...base,
      reportId: "RECEIVABLES_AGING",
      rows: [{ client: ref("c1", "CLIENT"), buckets, total: "10.00" }],
      totals: buckets,
    },
    {
      ...base,
      reportId: "EXPENSES_BY_MONTH_CATEGORY",
      chart: { periods: ["2026-09"], series: [{ id: "cat1", values: ["5.00"] }] },
    },
    { ...base, reportId: "NET_RESULT_MONTHLY", points: [{ period: "2026-09", value: "-5.00" }] },
    {
      ...base,
      reportId: "ACCOUNT_FLOW",
      rows: [
        { account: ref("acc1", "ACCOUNT"), period: "2026-09", inflow: "10.00", outflow: "4.00" },
      ],
    },
    {
      ...base,
      reportId: "COLLECTIONS_BY_METHOD",
      rows: [{ methodId: "m1", methodCode: "ZELLE", collected: "10.00", share: "100" }],
    },
  ];

  it.each(results)("accepts $reportId", (result) => {
    expect(reportResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects an unknown report id, a non-USD report and a mismatched series", () => {
    expect(reportResultSchema.safeParse({ ...results[0], reportId: "PROFIT_LOSS" }).success).toBe(
      false,
    );
    expect(reportResultSchema.safeParse({ ...results[0], currency: "VES" }).success).toBe(false);
    expect(
      reportResultSchema.safeParse({
        ...base,
        reportId: "BILLED_VS_COLLECTED",
        chart: { periods: ["2026-09", "2026-10"], series: [{ id: "billed", values: ["1.00"] }] },
      }).success,
    ).toBe(false);
    expect(
      reportResultSchema.safeParse({
        ...base,
        reportId: "COLLECTIONS_BY_METHOD",
        rows: [{ methodId: "m1", methodCode: "ZELLE", collected: "10.00", share: "101" }],
      }).success,
    ).toBe(false);
  });
});

describe("KPI result", () => {
  const kpi = {
    id: "MRR",
    unit: "USD",
    value: "1250.00",
    previousValue: "1100.00",
    changePercent: "13.64",
    sparkline: [{ period: "2026-09", value: "1100.00" }],
  };

  it("accepts a KPI, with or without enough data", () => {
    expect(kpiResultDtoSchema.safeParse(kpi).success).toBe(true);
    expect(
      kpiResultDtoSchema.safeParse({ ...kpi, id: "ON_TIME_PROJECTS", unit: "PERCENT", value: null })
        .success,
    ).toBe(true);
    expect(
      kpiResultDtoSchema.safeParse({
        ...kpi,
        id: "REVENUE_CONCENTRATION",
        unit: "PERCENT",
        breakdown: [{ key: "top1", value: "42.00" }],
      }).success,
    ).toBe(true);
  });

  it("rejects numbers, unknown ids and long sparklines", () => {
    expect(kpiResultDtoSchema.safeParse({ ...kpi, value: 1250 }).success).toBe(false);
    expect(kpiResultDtoSchema.safeParse({ ...kpi, id: "NPS" }).success).toBe(false);
    expect(
      kpiResultDtoSchema.safeParse({ ...kpi, sparkline: Array(13).fill(kpi.sparkline[0]) }).success,
    ).toBe(false);
  });
});

describe("ReportsService (A1)", () => {
  it("declares getReport and getKpi", () => {
    const names = ["getReport", "getKpi"] as const satisfies readonly (keyof ReportsService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
