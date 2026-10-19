// MOCK — tests for the reports and KPI services (PRD §8.13, HU-31 CA2 at service level) over the seeded
// dataset at FIXED_NOW (2026-10-09). Known figures: confirmed payments by Zelle into `acc_cobros_usd`,
// 2026-09-25 $300 and 2026-09-28 $500 (allocated to Kairos invoices) and 2026-10-02 $100 (IGTF $3); paid
// expenses from `acc_caja_ves` 2026-09-30 $2.38 (bank fees) and 2026-10-02 $0.60 (design, charged to
// `pry_kairos_web`); October invoices FAC-0001 (a `pry_kairos_web` line, 16 %: base 1,200 / IVA 192, $300
// applied), FAC-0002 (no IVA) and
// FAC-0004 (16 %: 900 / 144, 8 %: 500 / 40.01, 0 %: 200 / 0); FAC-0003 (Aug, $928, due 2026-09-19).
import { describe, expect, it } from "vitest";
import {
  KPI_ID_VALUES,
  REPORT_ID_VALUES,
  getKpiInputSchema,
  getReportInputSchema,
  kpiResultDtoSchema,
  reportResultSchema,
  type ReportResult,
  type ReportsService,
} from "@/lib/validators/reports";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import * as reportsService from "./reports";
import { getKpi, getReport } from "./reports";

const report = (id: string, filter: Record<string, unknown> = {}) =>
  getReportInputSchema.parse({ id, filter });
const kpi = (id: string, filter: Record<string, unknown> = {}) =>
  getKpiInputSchema.parse({ id, filter });

/** Narrows a report result to one id (the test fails if the service answered another one). */
function as<Id extends ReportResult["reportId"]>(result: ReportResult, id: Id) {
  expect(result.reportId).toBe(id);
  return result as Extract<ReportResult, { reportId: Id }>;
}

describe("access and ranges", () => {
  it("is Owner/Admin only (FORBIDDEN for Member and Viewer)", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const { ctx } = makeTestContext(role);
      await expect(getReport(ctx, report("COLLECTED_BY_MONTH"))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(getKpi(ctx, kpi("MRR"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it.each([
    ["THIS_MONTH", {}, "2026-10-01", "2026-10-31"],
    ["PREVIOUS_MONTH", {}, "2026-09-01", "2026-09-30"],
    ["QUARTER", {}, "2026-10-01", "2026-12-31"],
    ["YEAR", {}, "2026-01-01", "2026-12-31"],
    ["LAST_12_MONTHS", {}, "2025-11-01", "2026-10-31"],
    ["CUSTOM", { dateFrom: "2026-09-15", dateTo: "2026-10-05" }, "2026-09-15", "2026-10-05"],
  ] as const)("resolves %s from ctx.now", async (preset, extra, dateFrom, dateTo) => {
    const { ctx } = makeTestContext("ADMIN");
    const result = await getReport(ctx, report("COLLECTED_BY_MONTH", { preset, ...extra }));
    expect(result.range).toEqual({ dateFrom, dateTo });
  });
});

describe("the ten reports of §8.13.1", () => {
  it("every report answers a valid USD result for its id", async () => {
    const { ctx } = makeTestContext("OWNER");
    for (const id of REPORT_ID_VALUES) {
      const result = await getReport(ctx, report(id));
      expect(result.reportId).toBe(id);
      expect(reportResultSchema.safeParse(result).success, id).toBe(true);
    }
  });

  it("collected by month and billed vs collected", async () => {
    const { ctx } = makeTestContext("OWNER");
    const collected = as(await getReport(ctx, report("COLLECTED_BY_MONTH")), "COLLECTED_BY_MONTH");
    expect(collected.points).toHaveLength(12);
    expect(collected.points.slice(-2)).toEqual([
      { period: "2026-09", value: "800.00" },
      { period: "2026-10", value: "100.00" },
    ]);
    const versus = as(await getReport(ctx, report("BILLED_VS_COLLECTED")), "BILLED_VS_COLLECTED");
    const series = Object.fromEntries(versus.chart.series.map((s) => [s.id, s.values.slice(-3)]));
    expect(series).toEqual({
      billed: ["928.00", "0.00", "3976.01"],
      collected: ["0.00", "800.00", "100.00"],
    });
  });

  it("revenue by client and by project", async () => {
    const { ctx } = makeTestContext("OWNER");
    const byClient = as(await getReport(ctx, report("REVENUE_BY_CLIENT")), "REVENUE_BY_CLIENT");
    expect(byClient.rows.map((row) => [row.client.id, row.collected, row.billed])).toEqual([
      ["cli_kairos", "900.00", "2820.00"],
      ["cli_zafiro_labs", "0.00", "2084.01"],
    ]);
    const byProject = as(await getReport(ctx, report("REVENUE_BY_PROJECT")), "REVENUE_BY_PROJECT");
    expect(byProject.rows).toEqual([
      {
        project: expect.objectContaining({ id: "pry_kairos_web" }),
        collected: "300.00",
        margin: "299.40",
        marginPercent: "99.80",
      },
    ]);
  });

  it("receivables aging at the range close (today while it runs)", async () => {
    const { ctx } = makeTestContext("OWNER");
    const aging = as(await getReport(ctx, report("RECEIVABLES_AGING")), "RECEIVABLES_AGING");
    expect(aging.rows).toEqual([
      {
        client: expect.objectContaining({ id: "cli_kairos" }),
        buckets: { d0_30: "2020.00", d31_60: "0.00", d61_90: "0.00", d90plus: "0.00" },
        total: "2020.00",
      },
    ]);
    const later = as(
      await getReport(
        ctx,
        report("RECEIVABLES_AGING", {
          preset: "CUSTOM",
          dateFrom: "2026-10-01",
          dateTo: "2026-10-09",
        }),
      ),
      "RECEIVABLES_AGING",
    );
    expect(later.totals.d0_30).toBe("2020.00");
  });

  it("expenses by month and category, net result and account flow", async () => {
    const { ctx } = makeTestContext("OWNER");
    const expenses = as(
      await getReport(ctx, report("EXPENSES_BY_MONTH_CATEGORY")),
      "EXPENSES_BY_MONTH_CATEGORY",
    );
    const byCategory = Object.fromEntries(
      expenses.chart.series.map((s) => [s.id, s.values.slice(-2)]),
    );
    expect(byCategory).toEqual({
      ecat_comisiones_bancarias: ["2.38", "0.00"],
      ecat_freelancers_diseno: ["0.00", "0.60"],
    });
    expect(expenses.chart.series.every((s) => typeof s.label === "string")).toBe(true);
    const net = as(await getReport(ctx, report("NET_RESULT_MONTHLY")), "NET_RESULT_MONTHLY");
    expect(net.points.slice(-2)).toEqual([
      { period: "2026-09", value: "797.62" },
      { period: "2026-10", value: "99.40" },
    ]);
    const flow = as(await getReport(ctx, report("ACCOUNT_FLOW")), "ACCOUNT_FLOW");
    const rows = flow.rows.map((row) => [row.account.id, row.period, row.inflow, row.outflow]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["acc_cobros_usd", "2026-09", "800.00", "0.00"],
        ["acc_cobros_usd", "2026-10", "100.00", "0.00"],
        ["acc_caja_ves", "2026-09", "0.00", "2.38"],
        ["acc_zelle", "2026-09", "0.00", "100.00"],
        ["acc_binance", "2026-09", "100.00", "0.00"],
        ["acc_banco_ves", "2026-07", "0.00", "41.10"],
      ]),
    );
  });

  it("collections by method with their share", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const methods = as(
      await getReport(ctx, report("COLLECTIONS_BY_METHOD")),
      "COLLECTIONS_BY_METHOD",
    );
    const zelle = db.payments[0]!.method;
    expect(methods.rows).toEqual([
      { methodId: zelle.id, methodCode: "ZELLE", collected: "900.00", share: "100.00" },
    ]);
  });

  it("taxes registered: IVA per rate (DT-44), withholdings and IGTF", async () => {
    const { ctx } = makeTestContext("OWNER");
    const taxes = as(
      await getReport(ctx, report("TAXES_REGISTERED", { preset: "THIS_MONTH" })),
      "TAXES_REGISTERED",
    );
    expect(taxes.months.map((month) => month.period)).toEqual(["2026-10"]);
    expect(taxes.totals.ivaByRate).toEqual([
      { ivaRate: "16", taxBase: "2100.00", ivaAmount: "336.00" },
      { ivaRate: "8", taxBase: "500.00", ivaAmount: "40.01" },
      { ivaRate: "0", taxBase: "200.00", ivaAmount: "0.00" },
    ]);
    expect(taxes.totals.ivaTotal).toBe("376.01");
    expect(taxes.totals.igtf).toBe("3.00");
    expect(taxes.months[0]!.ivaByRate).toEqual(taxes.totals.ivaByRate);
  });

  it("the client filter narrows every figure to that client", async () => {
    const { ctx } = makeTestContext("OWNER");
    const filter = { clientId: "cli_zafiro_labs" };
    const byClient = as(
      await getReport(ctx, report("REVENUE_BY_CLIENT", filter)),
      "REVENUE_BY_CLIENT",
    );
    expect(byClient.rows.map((row) => row.client.id)).toEqual(["cli_zafiro_labs"]);
    const collected = as(
      await getReport(ctx, report("COLLECTED_BY_MONTH", filter)),
      "COLLECTED_BY_MONTH",
    );
    expect(collected.points.every((point) => point.value === "0.00")).toBe(true);
  });
});

describe("KPIs (§8.13.2)", () => {
  it("every KPI answers a valid card with its unit and a 12-month sparkline", async () => {
    const { ctx } = makeTestContext("OWNER");
    for (const id of KPI_ID_VALUES) {
      const result = await getKpi(ctx, kpi(id));
      expect(kpiResultDtoSchema.safeParse(result).success, id).toBe(true);
      expect(result.id).toBe(id);
      expect(result.sparkline.length).toBeLessThanOrEqual(12);
    }
  });

  it("MRR and ARR from the active charges; DSO, rates and margins over the range", async () => {
    const { ctx } = makeTestContext("OWNER");
    expect(await getKpi(ctx, kpi("MRR"))).toMatchObject({
      unit: "USD",
      value: "150.00",
      previousValue: "0.00",
      changePercent: null,
    });
    expect((await getKpi(ctx, kpi("ARR"))).value).toBe("1800.00");
    const thisMonth = { preset: "THIS_MONTH" };
    expect(await getKpi(ctx, kpi("COLLECTION_RATE", thisMonth))).toMatchObject({
      unit: "PERCENT",
      value: "2.52",
      previousValue: null,
    });
    expect((await getKpi(ctx, kpi("DELINQUENCY", thisMonth))).value).toBe("45.94");
    expect((await getKpi(ctx, kpi("OPERATING_MARGIN", thisMonth))).value).toBe("99.40");
    const sparkline = (await getKpi(ctx, kpi("MRR"))).sparkline;
    expect(sparkline).toHaveLength(12);
    expect(sparkline.at(-1)).toEqual({ period: "2026-10", value: "150.00" });
  });

  it("counts are strings; breakdowns carry user labels", async () => {
    const { ctx } = makeTestContext("OWNER");
    const stack = await getKpi(ctx, kpi("STACK_USAGE"));
    expect(stack.unit).toBe("COUNT");
    expect(stack.value).toMatch(/^\d+$/);
    expect(stack.breakdown?.[0]).toEqual({
      key: expect.stringMatching(/^tec_/),
      label: expect.any(String),
      value: expect.stringMatching(/^\d+$/),
    });
    expect((await getKpi(ctx, kpi("DOCUMENT_COVERAGE"))).value).toBe("0.00");
  });

  it("HU-31 CA2: changing the date range changes the value, comparison and sparkline end", async () => {
    const { ctx } = makeTestContext("OWNER");
    const october = await getKpi(ctx, kpi("NEW_CLIENTS", { preset: "THIS_MONTH" }));
    const september = await getKpi(ctx, kpi("NEW_CLIENTS", { preset: "PREVIOUS_MONTH" }));
    expect(october.value).not.toBe(september.value);
    expect(october.previousValue).toBe(september.value);
    expect(october.sparkline.at(-1)?.period).toBe("2026-10");
    expect(september.sparkline.at(-1)?.period).toBe("2026-09");
  });

  it("satisfies ReportsService over the mock context", () => {
    const service = reportsService satisfies ReportsService<MockServiceContext>;
    expect(typeof service.getKpi).toBe("function");
  });
});
