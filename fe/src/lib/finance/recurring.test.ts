import { describe, expect, it } from "vitest";

import { dueRecurringPeriods, normalizeToMonth, type RecurringSchedule } from "./recurring";

const monthly: RecurringSchedule = {
  frequency: "MENSUAL",
  startDate: "2026-01-05",
  endDate: null,
  billingDay: 5,
  leadDays: 7,
  status: "ACTIVO",
};

describe("dueRecurringPeriods (HU-10, §8.4.3)", () => {
  it("CA1: day 5 with 7 days of lead generates the period on the 28th or 29th of the month before", () => {
    // May 5 − 7 days = April 28; April 5 − 7 days = March 29.
    expect(dueRecurringPeriods(monthly, [], "2026-04-27")).not.toContainEqual(
      expect.objectContaining({ periodStart: "2026-05-05" }),
    );
    expect(
      dueRecurringPeriods(
        monthly,
        ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"],
        "2026-04-28",
      ),
    ).toEqual([{ periodStart: "2026-05-05", periodEnd: "2026-06-04", generateOn: "2026-04-28" }]);
    expect(
      dueRecurringPeriods(monthly, ["2026-01-05", "2026-02-05", "2026-03-05"], "2026-03-29"),
    ).toEqual([{ periodStart: "2026-04-05", periodEnd: "2026-05-04", generateOn: "2026-03-29" }]);
  });

  it("CA2: running twice the same day does not duplicate a period", () => {
    const existing = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"];
    const first = dueRecurringPeriods(monthly, existing, "2026-04-28");
    const second = dueRecurringPeriods(
      monthly,
      [...existing, ...first.map((period) => period.periodStart)],
      "2026-04-28",
    );
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("CA3: a paused or finished charge generates nothing", () => {
    expect(dueRecurringPeriods({ ...monthly, status: "PAUSADO" }, [], "2026-04-28")).toEqual([]);
    expect(dueRecurringPeriods({ ...monthly, status: "FINALIZADO" }, [], "2026-04-28")).toEqual([]);
  });

  it("generates only the next period, not the skipped ones, after the last existing one", () => {
    expect(dueRecurringPeriods(monthly, ["2026-01-05"], "2026-04-28")).toEqual([
      { periodStart: "2026-02-05", periodEnd: "2026-03-04", generateOn: "2026-01-29" },
    ]);
  });

  it("starts with the first period and stops after the end date", () => {
    expect(dueRecurringPeriods(monthly, [], "2025-12-29")).toEqual([
      { periodStart: "2026-01-05", periodEnd: "2026-02-04", generateOn: "2025-12-29" },
    ]);
    expect(
      dueRecurringPeriods({ ...monthly, endDate: "2026-01-31" }, ["2026-01-05"], "2026-01-29"),
    ).toEqual([]);
  });

  it("steps quarterly, half-yearly and yearly", () => {
    const quarterly = { ...monthly, frequency: "TRIMESTRAL" as const };
    expect(dueRecurringPeriods(quarterly, ["2026-01-05"], "2026-03-29")).toEqual([
      { periodStart: "2026-04-05", periodEnd: "2026-07-04", generateOn: "2026-03-29" },
    ]);
    expect(
      dueRecurringPeriods({ ...monthly, frequency: "ANUAL" }, ["2026-01-05"], "2026-12-29")[0]
        ?.periodStart,
    ).toBe("2027-01-05");
    expect(
      dueRecurringPeriods({ ...monthly, frequency: "SEMESTRAL" }, ["2026-01-05"], "2026-06-28")[0]
        ?.periodStart,
    ).toBe("2026-07-05");
  });
});

describe("normalizeToMonth (§8.13.2)", () => {
  it("divides quarterly by 3, half-yearly by 6 and yearly by 12", () => {
    expect(normalizeToMonth("100", "MENSUAL")).toBe("100.00");
    expect(normalizeToMonth("300", "TRIMESTRAL")).toBe("100.00");
    expect(normalizeToMonth("600", "SEMESTRAL")).toBe("100.00");
    expect(normalizeToMonth("1000", "ANUAL")).toBe("83.33");
  });
});
