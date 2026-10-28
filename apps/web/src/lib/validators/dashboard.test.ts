import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/dashboard.json";
import es from "@/i18n/messages/es/dashboard.json";
import {
  DASHBOARD_KPI_ID_VALUES,
  DASHBOARD_KPI_UNITS,
  DASHBOARD_MESSAGES,
  agingBucketsSchema,
  dashboardDtoSchema,
  dashboardQuerySchema,
  kpiCardDtoSchema,
  monthKeySchema,
  multiSeriesSchema,
  seriesPointSchema,
  signedDecimalSchema,
  type DashboardService,
} from "./dashboard";

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

describe("dashboard message keys", () => {
  it("exist in the dashboard namespace for es and en", () => {
    for (const key of Object.values(DASHBOARD_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("chart primitives", () => {
  it("month keys are YYYY-MM", () => {
    expect(monthKeySchema.safeParse("2026-10").success).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "202610", "2026-10-01"]) {
      expect(monthKeySchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("series values are decimal strings, never numbers", () => {
    expect(seriesPointSchema.safeParse({ period: "2026-10", value: "-12.50" }).success).toBe(true);
    expect(seriesPointSchema.safeParse({ period: "2026-10", value: 12.5 }).success).toBe(false);
    expect(seriesPointSchema.safeParse({ period: "2026-10", value: "12.555" }).success).toBe(false);
    expect(signedDecimalSchema.safeParse("12").success).toBe(true);
  });

  it("a multi-series needs one value per period", () => {
    const chart = {
      periods: ["2026-09", "2026-10"],
      series: [
        { id: "income", values: ["100.00", "200.00"] },
        { id: "expenses", values: ["50.00", "60.00"] },
      ],
    };
    expect(multiSeriesSchema.safeParse(chart).success).toBe(true);
    const broken = { ...chart, series: [{ id: "income", values: ["100.00"] }] };
    expect(messages(multiSeriesSchema.safeParse(broken))).toContain(
      DASHBOARD_MESSAGES.seriesLengthMismatch,
    );
  });

  it("aging buckets are non-negative decimals", () => {
    const buckets = { d0_30: "10.00", d31_60: "0.00", d61_90: "5.00", d90plus: "1.00" };
    expect(agingBucketsSchema.safeParse(buckets).success).toBe(true);
    expect(agingBucketsSchema.safeParse({ ...buckets, d90plus: "-1.00" }).success).toBe(false);
  });
});

describe("KPI cards (§8.1)", () => {
  it("lists the eight cards, each with a unit", () => {
    expect([...DASHBOARD_KPI_ID_VALUES]).toEqual([
      "COLLECTED_MONTH",
      "BILLED_MONTH",
      "RECEIVABLE",
      "EXPENSES_MONTH",
      "RESULT_MONTH",
      "ACCOUNTS_BALANCE",
      "MRR",
      "ACTIVE_PROJECTS",
    ]);
    for (const id of DASHBOARD_KPI_ID_VALUES) expect(DASHBOARD_KPI_UNITS[id]).toBeDefined();
    expect(DASHBOARD_KPI_UNITS.ACTIVE_PROJECTS).toBe("COUNT");
  });

  it("card DTO has the value, the previous period comparison and the overdue part", () => {
    const card = {
      id: "RECEIVABLE",
      unit: "USD",
      value: "4200.00",
      previousValue: "3900.00",
      changePercent: "7.69",
      secondaryValue: "800.00",
    };
    expect(kpiCardDtoSchema.safeParse(card).success).toBe(true);
    expect(
      kpiCardDtoSchema.safeParse({
        ...card,
        previousValue: null,
        changePercent: null,
        secondaryValue: null,
      }).success,
    ).toBe(true);
    expect(kpiCardDtoSchema.safeParse({ ...card, value: 4200 }).success).toBe(false);
    expect(kpiCardDtoSchema.safeParse({ ...card, id: "PROFIT" }).success).toBe(false);
  });
});

describe("dashboard DTO", () => {
  const card = (id: (typeof DASHBOARD_KPI_ID_VALUES)[number]) => ({
    id,
    unit: DASHBOARD_KPI_UNITS[id],
    value: "1.00",
    previousValue: null,
    changePercent: null,
    secondaryValue: null,
  });
  const dashboard = {
    month: "2026-10",
    currency: "USD",
    kpis: DASHBOARD_KPI_ID_VALUES.map(card),
    incomeVsExpenses: {
      periods: ["2026-09", "2026-10"],
      series: [
        { id: "income", values: ["1.00", "2.00"] },
        { id: "expenses", values: ["1.00", "1.00"] },
      ],
    },
    invoicesDue: [],
    installmentsToInvoice: [],
    documentsExpiring: [],
    upcomingRecurringExpenses: [],
    recentActivity: [],
  };

  it("accepts the full dashboard", () => {
    expect(dashboardDtoSchema.safeParse(dashboard).success).toBe(true);
  });

  it("needs exactly the eight cards and at most 5 invoices / 15 events", () => {
    expect(
      dashboardDtoSchema.safeParse({ ...dashboard, kpis: dashboard.kpis.slice(0, 7) }).success,
    ).toBe(false);
    const invoiceRow = {
      invoice: { id: "i1", label: "FAC-1", type: "INVOICE" },
      client: { id: "c1", label: "Acme", type: "CLIENT" },
      dueDate: "2026-10-01",
      currency: "USD",
      balance: "10.00",
      balanceUsd: "10.00",
      daysUntilDue: -8,
    };
    expect(dashboardDtoSchema.safeParse({ ...dashboard, invoicesDue: [invoiceRow] }).success).toBe(
      true,
    );
    expect(
      dashboardDtoSchema.safeParse({ ...dashboard, invoicesDue: Array(6).fill(invoiceRow) })
        .success,
    ).toBe(false);
    const event = {
      id: "a1",
      action: "CREATE",
      entity: null,
      actorName: null,
      createdAt: "2026-10-09T10:00:00Z",
    };
    expect(
      dashboardDtoSchema.safeParse({ ...dashboard, recentActivity: Array(16).fill(event) }).success,
    ).toBe(false);
  });

  it("is USD only", () => {
    expect(dashboardDtoSchema.safeParse({ ...dashboard, currency: "VES" }).success).toBe(false);
  });

  it("query month is optional and validated", () => {
    expect(dashboardQuerySchema.safeParse({}).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({ month: "2026-10" }).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({ month: "2026-1" }).success).toBe(false);
  });
});

describe("DashboardService (A1)", () => {
  it("declares getDashboard", () => {
    const names = ["getDashboard"] as const satisfies readonly (keyof DashboardService)[];
    expect(names).toEqual(["getDashboard"]);
  });
});
