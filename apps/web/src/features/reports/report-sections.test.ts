import { describe, expect, it } from "vitest";
import { KPI_ID_VALUES, REPORT_ID_VALUES } from "@/lib/validators/reports";
import { kpiSections, reportSections } from "./report-sections";
import { makeKpisResponse, makeReportResponse } from "./test-fixtures";

describe("reportSections", () => {
  it.each(REPORT_ID_VALUES)("draws one chart per section for %s", (id) => {
    const sections = reportSections(makeReportResponse(id));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.rows.length).toBeGreaterThan(0);
      expect(section.series.length).toBeGreaterThan(0);
      expect(section.columns.some((column) => column.key === section.category)).toBe(true);
    }
  });

  it("splits Impuestos registrados into the monthly table and the IVA per rate chart (DT-44)", () => {
    const [monthly, byRate] = reportSections(makeReportResponse("TAXES_REGISTERED"));
    expect(monthly!.key).toBe("main");
    expect(byRate!.key).toBe("byRate");
    expect(byRate!.rows).toEqual([{ ivaRate: "16", taxBase: "1000.00", ivaAmount: "160.00" }]);
  });

  it("keeps a null margin as null, so the table can read no data instead of zero", () => {
    const [section] = reportSections(makeReportResponse("REVENUE_BY_PROJECT"));
    expect(section!.rows[1]).toMatchObject({ margin: null, marginPercent: null });
  });

  it("keeps a null net result of a month as null", () => {
    const [section] = reportSections(makeReportResponse("NET_RESULT_MONTHLY"));
    expect(section!.rows[0]).toMatchObject({ period: "2026-09", net: null });
  });
});

describe("kpiSections", () => {
  it("draws the 12-month series and the breakdown when the KPI has one", () => {
    const kpis = makeKpisResponse().kpis;
    const stack = kpis.find((kpi) => kpi.id === "STACK_USAGE")!;
    expect(kpiSections(stack).map((section) => section.key)).toEqual(["sparkline", "breakdown"]);
    const mrr = kpis.find((kpi) => kpi.id === "MRR")!;
    expect(kpiSections(mrr).map((section) => section.key)).toEqual(["sparkline"]);
    expect(KPI_ID_VALUES.length).toBe(kpis.length);
  });
});
