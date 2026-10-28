import { describe, expect, it } from "vitest";

import { rateDeviationExceeds, selectRate, type RateRow } from "./rates";

const row = (
  date: string,
  currency: string,
  usdRate: string,
  source: RateRow["source"] = "BCV",
  createdAt = "2026-03-01T12:00:00.000Z",
): RateRow => ({ date, currency, usdRate, source, createdAt });

const rates: RateRow[] = [
  row("2026-03-10", "VES", "700.50000000"),
  row("2026-03-12", "VES", "755.16"),
  row("2026-03-14", "EUR", "0.92"),
  row("2026-03-05", "VES", "690"),
];

describe("selectRate (PRD §9.2 prefill order)", () => {
  it("returns the exact date and currency first", () => {
    expect(selectRate(rates, "2026-03-12", "VES")).toEqual({
      usdRate: "755.16",
      source: "BCV",
      isFallback: false,
      effectiveDate: "2026-03-12",
      options: [{ source: "BCV", usdRate: "755.16", createdAt: "2026-03-01T12:00:00.000Z" }],
    });
  });

  it("falls back to the latest previous rate and flags it", () => {
    expect(selectRate(rates, "2026-03-13", "VES")).toMatchObject({
      usdRate: "755.16",
      isFallback: true,
      effectiveDate: "2026-03-12",
    });
    expect(selectRate(rates, "2026-03-11", "VES")).toMatchObject({
      usdRate: "700.50000000",
      isFallback: true,
      effectiveDate: "2026-03-10",
    });
  });

  it("does not look at later dates or other currencies", () => {
    expect(selectRate(rates, "2026-03-04", "VES")).toBeNull();
    expect(selectRate(rates, "2026-03-13", "EUR")).toBeNull(); // EUR only has a later date
    expect(selectRate(rates, "2026-03-15", "EUR")).toMatchObject({
      usdRate: "0.92",
      isFallback: true,
      effectiveDate: "2026-03-14",
    });
  });

  it("returns null when nothing applies (manual entry)", () => {
    expect(selectRate([], "2026-03-12", "VES")).toBeNull();
    expect(selectRate(rates, "2026-03-12", "COP")).toBeNull();
  });

  it("always answers USD with 1, no source and no options", () => {
    expect(selectRate([], "2026-03-12", "USD")).toEqual({
      usdRate: "1",
      source: null,
      isFallback: false,
      effectiveDate: "2026-03-12",
      options: [],
    });
  });

  it("is independent of row order", () => {
    const shuffled = [...rates].reverse();
    expect(selectRate(shuffled, "2026-03-13", "VES")?.effectiveDate).toBe("2026-03-12");
  });

  it("ignores unusable rows (zero, negative, malformed)", () => {
    const bad: RateRow[] = [
      row("2026-03-12", "VES", "0"),
      row("2026-03-11", "VES", "-5"),
      row("2026-03-10", "VES", "abc"),
      row("2026-03-09", "VES", "700"),
    ];
    expect(selectRate(bad, "2026-03-12", "VES")).toMatchObject({
      usdRate: "700",
      isFallback: true,
      effectiveDate: "2026-03-09",
    });
  });
});

describe("selectRate — several sources per date (DT-67)", () => {
  const manual = row("2026-03-12", "VES", "760", "MANUAL", "2026-03-12T15:00:00.000Z");
  const otra = row("2026-03-12", "VES", "758", "OTRA", "2026-03-12T10:00:00.000Z");
  const bcv = row("2026-03-12", "VES", "755.16", "BCV", "2026-03-12T08:00:00.000Z");

  it("offers every source on the exact date and selects BCV even if it is the oldest", () => {
    const result = selectRate([manual, otra, bcv], "2026-03-12", "VES");
    expect(result).toMatchObject({
      usdRate: "755.16",
      source: "BCV",
      isFallback: false,
      effectiveDate: "2026-03-12",
    });
    expect(result?.options.map((o) => o.source)).toEqual(["BCV", "MANUAL", "OTRA"]);
    expect(result?.options[0]).toEqual({
      source: "BCV",
      usdRate: "755.16",
      createdAt: "2026-03-12T08:00:00.000Z",
    });
  });

  it("without BCV, the most recent createdAt wins", () => {
    const result = selectRate([otra, manual], "2026-03-12", "VES");
    expect(result).toMatchObject({ usdRate: "760", source: "MANUAL" });
    expect(result?.options.map((o) => o.source)).toEqual(["MANUAL", "OTRA"]);
    expect(selectRate([manual, otra], "2026-03-12", "VES")?.source).toBe("MANUAL");
  });

  it("orders deterministically regardless of input order", () => {
    const forward = selectRate([manual, otra, bcv], "2026-03-12", "VES");
    const backward = selectRate([bcv, otra, manual], "2026-03-12", "VES");
    expect(backward).toEqual(forward);
  });

  it("keeps input order for equal createdAt and treats a malformed createdAt as oldest", () => {
    const a = row("2026-03-12", "VES", "1", "MANUAL", "2026-03-12T10:00:00.000Z");
    const b = row("2026-03-12", "VES", "2", "OTRA", "2026-03-12T10:00:00.000Z");
    expect(selectRate([a, b], "2026-03-12", "VES")?.source).toBe("MANUAL");
    const broken = row("2026-03-12", "VES", "3", "MANUAL", "not-a-date");
    expect(selectRate([broken, b], "2026-03-12", "VES")?.source).toBe("OTRA");
  });

  it("offers every source on the fallback date, not the requested one", () => {
    const result = selectRate(
      [manual, otra, bcv, row("2026-03-01", "VES", "600")],
      "2026-03-13",
      "VES",
    );
    expect(result).toMatchObject({
      usdRate: "755.16",
      source: "BCV",
      isFallback: true,
      effectiveDate: "2026-03-12",
    });
    expect(result?.options.map((o) => o.source)).toEqual(["BCV", "MANUAL", "OTRA"]);
  });

  it("excludes non-positive rows from options and falls back past a date with only unusable rows", () => {
    const zero = row("2026-03-12", "VES", "0", "MANUAL", "2026-03-12T20:00:00.000Z");
    const negative = row("2026-03-12", "VES", "-3", "OTRA", "2026-03-12T21:00:00.000Z");
    const result = selectRate([zero, negative, bcv], "2026-03-12", "VES");
    expect(result?.options.map((o) => o.source)).toEqual(["BCV"]);

    const onlyBad = selectRate(
      [zero, negative, row("2026-03-10", "VES", "700", "OTRA")],
      "2026-03-12",
      "VES",
    );
    expect(onlyBad).toMatchObject({
      effectiveDate: "2026-03-10",
      isFallback: true,
      source: "OTRA",
    });
  });

  it("only mixes sources of the requested currency", () => {
    const eur = row("2026-03-12", "EUR", "0.92", "MANUAL");
    expect(selectRate([bcv, eur], "2026-03-12", "VES")?.options).toHaveLength(1);
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
