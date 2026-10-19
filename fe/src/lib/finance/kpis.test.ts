import { describe, expect, it } from "vitest";

import {
  computeArr,
  computeAvgProjectDuration,
  computeAvgProjectTicket,
  computeClientLtv,
  computeCollectionRate,
  computeDelinquency,
  computeDocumentCoverage,
  computeDso,
  computeFixedMonthlyExpense,
  computeMrr,
  computeOnTimeProjects,
  computeOperatingMargin,
  computeProjectMargin,
  computeProspectConversion,
  computeRevenueConcentration,
  computeRunway,
  computeStackUsage,
  countNewClients,
  type KpiPeriod,
} from "./kpis";

// HU-31 CA1: every KPI of §8.13.2 matches its formula over a known dataset (expected values by hand).
const september: KpiPeriod = { from: "2026-09-01", to: "2026-09-30" };
const thirdQuarter: KpiPeriod = { from: "2026-07-01", to: "2026-09-30" };

describe("MRR and ARR (§8.13.2)", () => {
  const charges = [
    { amountUsd: "1000.00", frequency: "MENSUAL", status: "ACTIVO" },
    { amountUsd: "900.00", frequency: "TRIMESTRAL", status: "ACTIVO" },
    { amountUsd: "1200.00", frequency: "SEMESTRAL", status: "ACTIVO" },
    { amountUsd: "2400.00", frequency: "ANUAL", status: "ACTIVO" },
    { amountUsd: "5000.00", frequency: "MENSUAL", status: "PAUSADO" },
  ] as const;

  it("MRR sums the active charges normalized to a month (quarterly ÷ 3, half-yearly ÷ 6, yearly ÷ 12)", () => {
    // 1000 + 300 + 200 + 200; the paused charge is left out.
    expect(computeMrr(charges)).toBe("1700.00");
    expect(computeMrr([])).toBe("0.00");
  });

  it("ARR is MRR × 12", () => {
    expect(computeArr("1700.00")).toBe("20400.00");
  });
});

describe("receivable KPIs (§8.13.2)", () => {
  it("DSO is (receivable at close ÷ billed in the period) × days of the period", () => {
    // 3000 / 9000 × 30 days.
    expect(computeDso({ receivableUsd: "3000.00", billedUsd: "9000.00", period: september })).toBe(
      "10.00",
    );
    expect(
      computeDso({ receivableUsd: "3000.00", billedUsd: "0.00", period: september }),
    ).toBeNull();
  });

  it("collection rate is collected ÷ billed in the period", () => {
    expect(computeCollectionRate({ collectedUsd: "7200.00", billedUsd: "9000.00" })).toBe("80.00");
    expect(computeCollectionRate({ collectedUsd: "7200.00", billedUsd: "0.00" })).toBeNull();
  });

  it("delinquency is overdue balance ÷ total receivable", () => {
    expect(computeDelinquency({ overdueUsd: "750.00", receivableUsd: "3000.00" })).toBe("25.00");
    expect(computeDelinquency({ overdueUsd: "0.00", receivableUsd: "0.00" })).toBeNull();
  });
});

describe("margins and expenses (§8.13.2)", () => {
  it("project margin is (collected − allocated expenses) ÷ collected, negative when expenses win", () => {
    expect(computeProjectMargin({ collectedUsd: "5000.00", allocatedExpensesUsd: "1250.00" })).toBe(
      "75.00",
    );
    expect(computeProjectMargin({ collectedUsd: "1000.00", allocatedExpensesUsd: "1500.00" })).toBe(
      "-50.00",
    );
    expect(
      computeProjectMargin({ collectedUsd: "0.00", allocatedExpensesUsd: "100.00" }),
    ).toBeNull();
  });

  it("operating margin is (collected − total expenses) ÷ collected", () => {
    expect(computeOperatingMargin({ collectedUsd: "8000.00", expensesUsd: "6000.00" })).toBe(
      "25.00",
    );
    expect(computeOperatingMargin({ collectedUsd: "0.00", expensesUsd: "6000.00" })).toBeNull();
  });

  it("fixed monthly expense sums the active recurring expenses normalized to a month", () => {
    expect(
      computeFixedMonthlyExpense([
        { amountUsd: "300.00", frequency: "MENSUAL", status: "ACTIVO" },
        { amountUsd: "600.00", frequency: "TRIMESTRAL", status: "ACTIVO" },
        { amountUsd: "1200.00", frequency: "ANUAL", status: "ACTIVO" },
        { amountUsd: "999.00", frequency: "MENSUAL", status: "FINALIZADO" },
      ]),
    ).toBe("600.00");
  });

  it("runway is the accounts balance ÷ the average monthly expense of the last 3 months", () => {
    expect(
      computeRunway({
        accountsBalanceUsd: "18000.00",
        lastThreeMonthsExpensesUsd: ["5000.00", "6000.00", "7000.00"],
      }),
    ).toBe("3.00");
    expect(
      computeRunway({
        accountsBalanceUsd: "18000.00",
        lastThreeMonthsExpensesUsd: ["0.00", "0.00", "0.00"],
      }),
    ).toBeNull();
  });
});

describe("clients and revenue (§8.13.2)", () => {
  it("revenue concentration is the share of the last 12 months collected by the top 1 and top 3 clients", () => {
    const allocations = [
      { clientId: "A", amountUsd: "5000.00", date: "2026-01-10" },
      { clientId: "A", amountUsd: "1000.00", date: "2025-09-30" }, // 12 months ago: outside
      { clientId: "B", amountUsd: "3000.00", date: "2026-05-01" },
      { clientId: "C", amountUsd: "1000.00", date: "2026-09-30" },
      { clientId: "D", amountUsd: "1000.00", date: "2026-02-02" },
      { clientId: "E", amountUsd: "500.00", date: "2024-12-01" },
      { clientId: "F", amountUsd: "200.00", date: "2026-10-01" }, // after asOf: outside
    ];
    // Window total 10000: A 5000, B 3000, then C/D 1000.
    expect(computeRevenueConcentration(allocations, "2026-09-30")).toEqual({
      top1: "50.00",
      top3: "90.00",
    });
    expect(computeRevenueConcentration([], "2026-09-30")).toEqual({ top1: null, top3: null });
  });

  it("average project ticket is the mean contracted value of the projects started in the period", () => {
    const projects = [
      { startDate: "2026-07-15", contractedUsd: "12000.00" },
      { startDate: "2026-09-30", contractedUsd: "6000.00" },
      { startDate: "2026-06-30", contractedUsd: "99999.00" }, // before the period
      { startDate: "2026-08-01", contractedUsd: null }, // no contracted value
      { startDate: null, contractedUsd: "500.00" }, // not started
    ];
    expect(computeAvgProjectTicket(projects, thirdQuarter)).toBe("9000.00");
    expect(computeAvgProjectTicket(projects, september)).toBe("6000.00");
    expect(computeAvgProjectTicket([], september)).toBeNull();
  });

  it("LTV is the historical collected per client, ranked, plus its average", () => {
    const result = computeClientLtv([
      { clientId: "B", amountUsd: "500.00" },
      { clientId: "A", amountUsd: "1000.00" },
      { clientId: "A", amountUsd: "2500.00" },
      { clientId: "C", amountUsd: "0.00" },
    ]);
    expect(result.perClient).toEqual([
      { clientId: "A", ltvUsd: "3500.00" },
      { clientId: "B", ltvUsd: "500.00" },
      { clientId: "C", ltvUsd: "0.00" },
    ]);
    // 4000 / 3.
    expect(result.averageUsd).toBe("1333.33");
    expect(computeClientLtv([])).toEqual({ perClient: [], averageUsd: null });
  });

  it("new clients counts the clients that became ACTIVO in the period", () => {
    expect(
      countNewClients(
        [
          { activatedAt: "2026-09-05" },
          { activatedAt: "2026-09-30" },
          { activatedAt: "2026-08-31" },
          { activatedAt: null },
        ],
        september,
      ),
    ).toBe(2);
  });

  it("prospect conversion is prospects that became ACTIVO ÷ prospects created in the period", () => {
    const prospects = [
      { createdAt: "2026-09-02", activatedAt: "2026-09-20" }, // converted
      { createdAt: "2026-09-10", activatedAt: null },
      { createdAt: "2026-09-15", activatedAt: "2026-10-03" }, // converted after the period
      { createdAt: "2026-08-20", activatedAt: "2026-09-05" }, // created before the period
    ];
    expect(computeProspectConversion(prospects, september)).toBe("33.33");
    expect(
      computeProspectConversion(prospects, { from: "2026-11-01", to: "2026-11-30" }),
    ).toBeNull();
  });
});

describe("projects (§8.13.2)", () => {
  const delivered = [
    { startDate: "2026-01-01", estimatedEndDate: "2026-01-31", deliveredDate: "2026-01-31" },
    { startDate: "2026-02-01", estimatedEndDate: "2026-03-01", deliveredDate: "2026-03-03" },
    { startDate: "2026-04-01", estimatedEndDate: "2026-05-01", deliveredDate: "2026-04-16" },
    { startDate: "2026-05-01", estimatedEndDate: null, deliveredDate: "2026-06-01" },
    { startDate: "2026-06-01", estimatedEndDate: "2026-07-01", deliveredDate: null },
  ];

  it("average duration is the mean of (actual delivery − start) of the delivered projects", () => {
    // 30, 30, 15 and 31 days.
    expect(computeAvgProjectDuration(delivered)).toBe("26.50");
    expect(computeAvgProjectDuration([delivered[4]!])).toBeNull();
  });

  it("on-time projects is the share delivered on or before the estimated date", () => {
    // On time: Jan 31 = Jan 31 and Apr 16 < May 1; late: Mar 3 > Mar 1. No estimate: left out.
    expect(computeOnTimeProjects(delivered)).toBe("66.67");
    expect(computeOnTimeProjects([delivered[3]!, delivered[4]!])).toBeNull();
  });

  it("stack usage counts projects per technology, most used first", () => {
    expect(
      computeStackUsage([
        { technologies: ["react", "node"] },
        { technologies: ["react", "postgres"] },
        { technologies: ["react", "react"] },
        { technologies: [] },
      ]),
    ).toEqual([
      { technology: "react", projects: 3 },
      { technology: "node", projects: 1 },
      { technology: "postgres", projects: 1 },
    ]);
  });

  it("document coverage is the share of active projects with a FIRMADO contract and a current NDA", () => {
    const projects = [
      { status: "EN_CURSO", hasSignedContract: true, hasCurrentNda: true },
      { status: "MANTENIMIENTO", hasSignedContract: true, hasCurrentNda: false },
      { status: "EN_CURSO", hasSignedContract: true, hasCurrentNda: true },
      { status: "EN_CURSO", hasSignedContract: false, hasCurrentNda: false },
      { status: "ENTREGADO", hasSignedContract: true, hasCurrentNda: true }, // not active
    ] as const;
    expect(computeDocumentCoverage(projects)).toBe("50.00");
    expect(computeDocumentCoverage([projects[4]])).toBeNull();
  });
});
