import { describe, expect, it } from "vitest";
import { parseDashboardPeriod } from "./period";

describe("parseDashboardPeriod", () => {
  it("accepts month, quarter and year and falls back to month", () => {
    expect(parseDashboardPeriod("quarter")).toBe("quarter");
    expect(parseDashboardPeriod("year")).toBe("year");
    expect(parseDashboardPeriod(["year"])).toBe("year");
    expect(parseDashboardPeriod("week")).toBe("month");
    expect(parseDashboardPeriod(undefined)).toBe("month");
  });
});
