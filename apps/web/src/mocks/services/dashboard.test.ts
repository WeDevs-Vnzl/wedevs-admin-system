// MOCK — tests for the dashboard service (PRD §8.1) over the seeded dataset at FIXED_NOW (2026-10-09).
// Known figures: payments 2026-09-25 $300 and 2026-09-28 $500 (both allocated), 2026-10-02 $100; paid
// expenses 2026-09-30 $2.38 and 2026-10-02 $0.60; invoices FAC-0001 (issued 2026-10-09, $1,392, $300
// applied), FAC-0002 ($500, 2026-10-14), FAC-0003 (2026-08-20, $928, due 2026-09-19), FAC-0004 ($2,084.01,
// 2026-10-15); one active $150 monthly charge; one active $20 monthly recurring expense due 2026-11-05.
import { describe, expect, it } from "vitest";
import {
  dashboardDtoSchema,
  type DashboardService,
  type KpiCardDTO,
} from "@/lib/validators/dashboard";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import * as dashboardService from "./dashboard";
import { getDashboard } from "./dashboard";

const card = (cards: KpiCardDTO[], id: KpiCardDTO["id"]) => cards.find((item) => item.id === id)!;

describe("getDashboard (PRD §8.1)", () => {
  it("returns a valid USD dashboard for the current business month", async () => {
    const { ctx } = makeTestContext("OWNER");
    const dashboard = await getDashboard(ctx, {});
    expect(dashboardDtoSchema.safeParse(dashboard).success).toBe(true);
    expect(dashboard).toMatchObject({ month: "2026-10", currency: "USD" });
    expect(dashboard.kpis.map((item) => item.id)).toEqual([
      "COLLECTED_MONTH",
      "BILLED_MONTH",
      "RECEIVABLE",
      "EXPENSES_MONTH",
      "RESULT_MONTH",
      "ACCOUNTS_BALANCE",
      "MRR",
      "ACTIVE_PROJECTS",
    ]);
  });

  it("computes the eight cards from the USD snapshots, compared with the previous month", async () => {
    const { ctx } = makeTestContext("OWNER");
    const { kpis } = await getDashboard(ctx, {});
    expect(card(kpis, "COLLECTED_MONTH")).toMatchObject({
      unit: "USD",
      value: "100.00",
      previousValue: "800.00",
      changePercent: "-87.50",
      secondaryValue: null,
    });
    expect(card(kpis, "BILLED_MONTH")).toMatchObject({
      value: "3976.01",
      previousValue: "0.00",
      changePercent: null,
    });
    expect(card(kpis, "RECEIVABLE")).toMatchObject({
      value: "2020.00",
      previousValue: "928.00",
      changePercent: "117.67",
      secondaryValue: "928.00",
    });
    expect(card(kpis, "EXPENSES_MONTH")).toMatchObject({ value: "0.60", previousValue: "2.38" });
    expect(card(kpis, "RESULT_MONTH")).toMatchObject({
      value: "99.40",
      previousValue: "797.62",
      changePercent: "-87.54",
    });
    expect(card(kpis, "ACCOUNTS_BALANCE")).toMatchObject({ value: "2206.28", previousValue: null });
    expect(card(kpis, "MRR")).toMatchObject({
      value: "150.00",
      previousValue: "150.00",
      changePercent: "0.00",
    });
    expect(card(kpis, "ACTIVE_PROJECTS")).toMatchObject({ unit: "COUNT", value: "12" });
  });

  it("a past month is computed at its own close", async () => {
    const { ctx } = makeTestContext("OWNER");
    const { kpis, month } = await getDashboard(ctx, { month: "2026-09" });
    expect(month).toBe("2026-09");
    expect(card(kpis, "COLLECTED_MONTH")).toMatchObject({ value: "800.00", previousValue: "0.00" });
    expect(card(kpis, "RECEIVABLE")).toMatchObject({ value: "928.00", secondaryValue: "928.00" });
  });

  it("charts income against expenses over the last 12 months", async () => {
    const { ctx } = makeTestContext("OWNER");
    const { incomeVsExpenses } = await getDashboard(ctx, {});
    expect(incomeVsExpenses.periods).toHaveLength(12);
    expect(incomeVsExpenses.periods[0]).toBe("2025-11");
    expect(incomeVsExpenses.periods[11]).toBe("2026-10");
    const series = Object.fromEntries(incomeVsExpenses.series.map((s) => [s.id, s.values]));
    expect(series.income?.slice(-2)).toEqual(["800.00", "100.00"]);
    expect(series.expenses?.slice(-2)).toEqual(["2.38", "0.60"]);
    expect(series.income?.[0]).toBe("0.00");
  });

  it("lists the top overdue and due invoices, installments, documents and recurring expenses", async () => {
    const { ctx } = makeTestContext("OWNER");
    const dashboard = await getDashboard(ctx, {});
    expect(
      dashboard.invoicesDue.map((row) => [row.invoice.code, row.daysUntilDue, row.balanceUsd]),
    ).toEqual([
      ["FAC-0003", -20, "928.00"],
      ["FAC-0001", 30, "1092.00"],
      ["FAC-0004", 35, "2084.01"],
    ]);
    expect(dashboard.installmentsToInvoice.map((row) => row.installment.id)).toEqual([
      "ins_maintenance_1",
      "ins_maintenance_2",
    ]);
    expect(dashboard.documentsExpiring).toEqual([
      {
        document: expect.objectContaining({ code: "DOC-0002", type: "DOCUMENT" }),
        expiresAt: "2026-10-30",
        daysLeft: 21,
      },
    ]);
    expect(dashboard.upcomingRecurringExpenses).toEqual([
      expect.objectContaining({ dueDate: "2026-11-05", amount: "20.00", amountUsd: "20.00" }),
    ]);
  });

  it("shows the last 15 activity events, newest first", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const { recentActivity } = await getDashboard(ctx, {});
    const newest = [...db.activity].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
    expect(recentActivity.map((row) => row.id)).toEqual(newest.slice(0, 15).map((row) => row.id));
  });

  it("gives Members the dashboard without financial data or the activity log", async () => {
    const { ctx } = makeTestContext("MEMBER");
    const dashboard = await getDashboard(ctx, {});
    expect(dashboardDtoSchema.safeParse(dashboard).success).toBe(true);
    expect(card(dashboard.kpis, "COLLECTED_MONTH")).toMatchObject({
      value: "0.00",
      previousValue: null,
      changePercent: null,
    });
    expect(card(dashboard.kpis, "ACTIVE_PROJECTS").value).toBe("12");
    expect(dashboard.invoicesDue).toEqual([]);
    expect(dashboard.installmentsToInvoice).toEqual([]);
    expect(dashboard.upcomingRecurringExpenses).toEqual([]);
    expect(dashboard.recentActivity).toEqual([]);
    expect(dashboard.documentsExpiring).toHaveLength(1);
  });

  it("satisfies DashboardService over the mock context", () => {
    const service = dashboardService satisfies DashboardService<MockServiceContext>;
    expect(typeof service.getDashboard).toBe("function");
  });
});
