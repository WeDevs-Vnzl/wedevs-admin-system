import { describe, expect, it } from "vitest";
import { canonicalDecimal, formatDecimalForInput, getSeparators, parseLocalizedDecimal } from "./parse";

const MONEY = { maxDecimals: 2 };
const RATE = { maxDecimals: 8 };

describe("getSeparators", () => {
  it("reads the locale's decimal and group marks", () => {
    expect(getSeparators("es")).toEqual({ decimal: ",", group: "." });
    expect(getSeparators("en")).toEqual({ decimal: ".", group: "," });
  });
});

describe("parseLocalizedDecimal", () => {
  it("normalizes ES typing to the canonical string", () => {
    expect(parseLocalizedDecimal("1.234,56", "es", MONEY)).toBe("1234.56");
    expect(parseLocalizedDecimal("1.234.567,5", "es", MONEY)).toBe("1234567.5");
    expect(parseLocalizedDecimal("0,5", "es", MONEY)).toBe("0.5");
    expect(parseLocalizedDecimal(",5", "es", MONEY)).toBe("0.5");
  });

  it("normalizes EN typing to the canonical string", () => {
    expect(parseLocalizedDecimal("1,234.56", "en", MONEY)).toBe("1234.56");
    expect(parseLocalizedDecimal("1234.5", "en", MONEY)).toBe("1234.5");
  });

  it("reads a lone separator as thousands only when exactly three digits follow", () => {
    expect(parseLocalizedDecimal("1.234", "es", MONEY)).toBe("1234");
    expect(parseLocalizedDecimal("1,234", "en", MONEY)).toBe("1234");
    expect(parseLocalizedDecimal("755.16", "es", RATE)).toBe("755.16");
    expect(parseLocalizedDecimal("12,5", "en", MONEY)).toBe("12.5");
  });

  it("drops a dangling separator and leading zeros", () => {
    expect(parseLocalizedDecimal("12,", "es", MONEY)).toBe("12");
    expect(parseLocalizedDecimal("007", "es", MONEY)).toBe("7");
  });

  it("rounds half up to the field's decimals", () => {
    expect(parseLocalizedDecimal("1.239", "en", MONEY)).toBe("1.24");
    expect(parseLocalizedDecimal("0,005", "es", MONEY)).toBe("0.01");
    expect(parseLocalizedDecimal("755,123456789", "es", RATE)).toBe("755.12345679");
  });

  it("returns '' for blank input and null for unreadable input", () => {
    expect(parseLocalizedDecimal("  ", "es", MONEY)).toBe("");
    expect(parseLocalizedDecimal("abc", "es", MONEY)).toBeNull();
    expect(parseLocalizedDecimal("1.2.3,4", "es", MONEY)).toBeNull();
    expect(parseLocalizedDecimal("1,2,3", "es", MONEY)).toBeNull();
    expect(parseLocalizedDecimal("-", "es", MONEY)).toBeNull();
  });

  it("accepts a sign only when negatives are allowed", () => {
    expect(parseLocalizedDecimal("-5,5", "es", MONEY)).toBeNull();
    expect(parseLocalizedDecimal("-5,5", "es", { ...MONEY, allowNegative: true })).toBe("-5.5");
    expect(parseLocalizedDecimal("-0", "es", { ...MONEY, allowNegative: true })).toBe("0");
  });
});

describe("canonicalDecimal / formatDecimalForInput", () => {
  it("prints without exponent or trailing zeros", () => {
    expect(canonicalDecimal("1234.50", 2)).toBe("1234.5");
    expect(canonicalDecimal("0.0000001", 2)).toBe("0");
  });

  it("formats a canonical string for display in the locale", () => {
    const money = { minFractionDigits: 2, maxFractionDigits: 2 };
    expect(formatDecimalForInput("1234.5", "es", money)).toBe("1.234,50");
    expect(formatDecimalForInput("1234.5", "en", money)).toBe("1,234.50");
    expect(formatDecimalForInput("", "en", money)).toBe("");
  });
});
