import { describe, expect, it } from "vitest";
import {
  DASHBOARD_KPI_ID_VALUES,
  type DashboardKpiId,
  type KpiCardDTO,
} from "@/lib/validators/dashboard";
import { aggregatePeriodKpis, parseDashboardPeriod, periodMonths } from "./period";

function kpis(values: Partial<Record<DashboardKpiId, string>>, overdue = "0.00"): KpiCardDTO[] {
  return DASHBOARD_KPI_ID_VALUES.map((id) => ({
    id,
    unit: id === "ACTIVE_PROJECTS" ? "COUNT" : "USD",
    value: values[id] ?? "0.00",
    previousValue: null,
    changePercent: null,
    secondaryValue: id === "RECEIVABLE" ? overdue : null,
  }));
}

const byId = (cards: KpiCardDTO[], id: DashboardKpiId) => cards.find((card) => card.id === id)!;

describe("parseDashboardPeriod", () => {
  it("accepts month, quarter and year and falls back to month", () => {
    expect(parseDashboardPeriod("quarter")).toBe("quarter");
    expect(parseDashboardPeriod("year")).toBe("year");
    expect(parseDashboardPeriod(["year"])).toBe("year");
    expect(parseDashboardPeriod("week")).toBe("month");
    expect(parseDashboardPeriod(undefined)).toBe("month");
  });
});

describe("periodMonths", () => {
  it("covers the period to date and the same months of the previous period", () => {
    expect(periodMonths("2026-10", "month")).toEqual({
      months: ["2026-10"],
      previousMonths: ["2026-09"],
    });
    expect(periodMonths("2026-11", "quarter")).toEqual({
      months: ["2026-10", "2026-11"],
      previousMonths: ["2026-07", "2026-08"],
    });
    expect(periodMonths("2026-02", "year")).toEqual({
      months: ["2026-01", "2026-02"],
      previousMonths: ["2025-01", "2025-02"],
    });
  });
});

describe("aggregatePeriodKpis", () => {
  it("sums the flow cards, takes the stocks at the period close and compares with the previous period", () => {
    const current = [
      kpis({ COLLECTED_MONTH: "100.00", EXPENSES_MONTH: "40.00", RESULT_MONTH: "60.00" }),
      kpis(
        {
          COLLECTED_MONTH: "200.00",
          BILLED_MONTH: "300.00",
          EXPENSES_MONTH: "60.00",
          RESULT_MONTH: "140.00",
          RECEIVABLE: "900.00",
          MRR: "50.00",
          ACCOUNTS_BALANCE: "5000.00",
          ACTIVE_PROJECTS: "3",
        },
        "150.00",
      ),
    ];
    const previous = [
      kpis({ COLLECTED_MONTH: "150.00", EXPENSES_MONTH: "100.00", RESULT_MONTH: "50.00" }),
      kpis({ COLLECTED_MONTH: "50.00", RECEIVABLE: "600.00", MRR: "0.00" }),
    ];

    const cards = aggregatePeriodKpis(current, previous);

    expect(cards.map((card) => card.id)).toEqual([...DASHBOARD_KPI_ID_VALUES]);
    expect(byId(cards, "COLLECTED_MONTH")).toMatchObject({
      value: "300.00",
      previousValue: "200.00",
      changePercent: "50.00",
    });
    expect(byId(cards, "BILLED_MONTH")).toMatchObject({
      value: "300.00",
      previousValue: "0.00",
      changePercent: null,
    });
    expect(byId(cards, "EXPENSES_MONTH")).toMatchObject({
      value: "100.00",
      previousValue: "100.00",
      changePercent: "0.00",
    });
    expect(byId(cards, "RESULT_MONTH")).toMatchObject({ value: "200.00", previousValue: "50.00" });
    expect(byId(cards, "RECEIVABLE")).toMatchObject({
      value: "900.00",
      previousValue: "600.00",
      changePercent: "50.00",
      secondaryValue: "150.00",
    });
    expect(byId(cards, "MRR")).toMatchObject({ value: "50.00", previousValue: "0.00" });
    expect(byId(cards, "ACCOUNTS_BALANCE")).toMatchObject({
      value: "5000.00",
      previousValue: null,
    });
    expect(byId(cards, "ACTIVE_PROJECTS")).toMatchObject({ value: "3", previousValue: null });
  });
});
