import { describe, expect, it } from "vitest";

import { rateDeviationExceeds, selectRate, type RateRow } from "./rates";

const rates: RateRow[] = [
  { date: "2026-03-10", currency: "VES", usdRate: "700.50000000" },
  { date: "2026-03-12", currency: "VES", usdRate: "755.16" },
  { date: "2026-03-14", currency: "EUR", usdRate: "0.92" },
  { date: "2026-03-05", currency: "VES", usdRate: "690" },
];

describe("selectRate (PRD §9.2 prefill order)", () => {
  it("returns the exact date and currency first", () => {
    expect(selectRate(rates, "2026-03-12", "VES")).toEqual({
      usdRate: "755.16",
      isFallback: false,
      effectiveDate: "2026-03-12",
    });
  });

  it("falls back to the latest previous rate and flags it", () => {
    expect(selectRate(rates, "2026-03-13", "VES")).toEqual({
      usdRate: "755.16",
      isFallback: true,
      effectiveDate: "2026-03-12",
    });
    expect(selectRate(rates, "2026-03-11", "VES")).toEqual({
      usdRate: "700.50000000",
      isFallback: true,
      effectiveDate: "2026-03-10",
    });
  });

  it("does not look at later dates or other currencies", () => {
    expect(selectRate(rates, "2026-03-04", "VES")).toBeNull();
    expect(selectRate(rates, "2026-03-13", "EUR")).toBeNull(); // EUR only has a later date
    expect(selectRate(rates, "2026-03-15", "EUR")).toEqual({
      usdRate: "0.92",
      isFallback: true,
      effectiveDate: "2026-03-14",
    });
  });

  it("returns null when nothing applies (manual entry)", () => {
    expect(selectRate([], "2026-03-12", "VES")).toBeNull();
    expect(selectRate(rates, "2026-03-12", "COP")).toBeNull();
  });

  it("always answers USD with 1", () => {
    expect(selectRate([], "2026-03-12", "USD")).toEqual({
      usdRate: "1",
      isFallback: false,
      effectiveDate: "2026-03-12",
    });
  });

  it("is independent of row order and keeps the first of duplicate dates", () => {
    const shuffled = [...rates].reverse();
    expect(selectRate(shuffled, "2026-03-13", "VES")?.effectiveDate).toBe("2026-03-12");
    const dup: RateRow[] = [
      { date: "2026-03-12", currency: "VES", usdRate: "1" },
      { date: "2026-03-12", currency: "VES", usdRate: "2" },
    ];
    expect(selectRate(dup, "2026-03-12", "VES")?.usdRate).toBe("1");
  });

  it("ignores unusable rows (zero, negative, malformed)", () => {
    const bad: RateRow[] = [
      { date: "2026-03-12", currency: "VES", usdRate: "0" },
      { date: "2026-03-11", currency: "VES", usdRate: "-5" },
      { date: "2026-03-10", currency: "VES", usdRate: "abc" },
      { date: "2026-03-09", currency: "VES", usdRate: "700" },
    ];
    expect(selectRate(bad, "2026-03-12", "VES")).toEqual({
      usdRate: "700",
      isFallback: true,
      effectiveDate: "2026-03-09",
    });
  });
});

describe("rateDeviationExceeds (PRD §15)", () => {
  it("is false at exactly the threshold and true beyond it", () => {
    expect(rateDeviationExceeds("110", "100", "10")).toBe(false);
    expect(rateDeviationExceeds("110.01", "100", "10")).toBe(true);
    expect(rateDeviationExceeds("90", "100", "10")).toBe(false);
    expect(rateDeviationExceeds("89.99", "100", "10")).toBe(true);
  });

  it("defaults to 10 %", () => {
    expect(rateDeviationExceeds("120", "100")).toBe(true);
    expect(rateDeviationExceeds("105", "100")).toBe(false);
  });

  it("uses VES-scale rates without float drift", () => {
    expect(rateDeviationExceeds("830.676", "755.16", "10")).toBe(false); // exactly +10 %
    expect(rateDeviationExceeds("830.67601", "755.16", "10")).toBe(true);
  });

  it("is false when there is no valid previous rate", () => {
    expect(rateDeviationExceeds("100", null)).toBe(false);
    expect(rateDeviationExceeds("100", undefined)).toBe(false);
    expect(rateDeviationExceeds("100", "0")).toBe(false);
  });
});
