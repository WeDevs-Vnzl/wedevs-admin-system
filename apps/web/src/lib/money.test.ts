import { describe, expect, it } from "vitest";

import {
  addMoney,
  compareMoney,
  formatMoney,
  fromUsd,
  isDecimalString,
  isNegativeMoney,
  isSettled,
  isZeroMoney,
  mulMoney,
  percentOf,
  roundMoney,
  roundRate,
  subMoney,
  sumMoney,
  toDecimal,
  toUsd,
} from "./money";

describe("toDecimal / isDecimalString", () => {
  it("accepts plain decimal strings", () => {
    for (const ok of ["0", "12", "12.5", "-3.20", ".5", "755.16"]) {
      expect(isDecimalString(ok)).toBe(true);
      expect(toDecimal(ok).toString()).toBeDefined();
    }
  });

  it("rejects separators, exponents, blanks and non-strings", () => {
    for (const bad of ["", " ", "1,000.00", "1e5", "1.", "--1", "abc", "NaN", "Infinity", "1 2"]) {
      expect(isDecimalString(bad)).toBe(false);
      expect(() => toDecimal(bad)).toThrow(RangeError);
    }
    expect(isDecimalString(12)).toBe(false);
    expect(isDecimalString(null)).toBe(false);
  });
});

describe("roundMoney (ROUND_HALF_UP, 2 dp)", () => {
  it.each([
    ["1.005", "1.01"],
    ["1.004", "1.00"],
    ["2.675", "2.68"],
    ["0.125", "0.13"],
    ["0.115", "0.12"],
    ["1.015", "1.02"],
    ["-1.005", "-1.01"],
    ["-0.004", "0.00"],
    ["-0.005", "-0.01"],
    ["10", "10.00"],
    ["0", "0.00"],
    ["1234567890123456.785", "1234567890123456.79"],
  ])("rounds %s to %s", (input, expected) => {
    expect(roundMoney(input)).toBe(expected);
  });

  it("rounds rates to 8 dp", () => {
    expect(roundRate("755.123456785")).toBe("755.12345679");
    expect(roundRate("1")).toBe("1.00000000");
  });
});

describe("sum / add / sub / mul", () => {
  it("sums exactly where floats drift", () => {
    expect(sumMoney(["0.1", "0.2"])).toBe("0.30");
    expect(sumMoney([])).toBe("0.00");
    expect(sumMoney(["0.10", "0.20", "0.30", "-0.60"])).toBe("0.00");
  });

  it("adds and subtracts", () => {
    expect(addMoney("0.1", "0.2")).toBe("0.30");
    expect(subMoney("100", "3")).toBe("97.00");
    expect(subMoney("0.3", "0.1")).toBe("0.20");
  });

  it("multiplies and rounds half up (line amount = quantity × unitPrice)", () => {
    expect(mulMoney("3", "19.99")).toBe("59.97");
    expect(mulMoney("1.5", "0.01")).toBe("0.02");
    expect(mulMoney("0.333", "3")).toBe("1.00");
  });
});

describe("HU-13 CA2 arithmetic", () => {
  it("100 USD payment with 3 IGTF: allocatable 97, net credited 100", () => {
    const amount = "100";
    const igtf = "3";
    const fee = "0";
    expect(subMoney(amount, igtf)).toBe("97.00");
    expect(subMoney(amount, fee)).toBe("100.00");
  });

  it("IGTF 3 % of 100 is 3.00", () => {
    expect(percentOf("100", "3")).toBe("3.00");
  });
});

describe("percentOf (VAT)", () => {
  it.each([
    ["100", "16", "16.00"],
    ["100", "8", "8.00"],
    ["100", "0", "0.00"],
    ["0.05", "16", "0.01"], // 0.008 → 0.01
    ["0.03", "16", "0.00"], // 0.0048 → 0.00
    ["10.03", "16", "1.60"], // 1.6048
    ["10.05", "16", "1.61"], // 1.608
    ["33.33", "16", "5.33"], // 5.3328
    ["0.03125", "16", "0.01"], // 0.005 → half up
    ["-100", "16", "-16.00"],
  ])("%s at %s%% = %s", (base, rate, expected) => {
    expect(percentOf(base, rate)).toBe(expected);
  });
});

describe("toUsd / fromUsd with VES 755.16", () => {
  it("converts VES to USD rounding half up", () => {
    expect(toUsd("755.16", "755.16")).toBe("1.00");
    expect(toUsd("1000", "755.16")).toBe("1.32"); // 1.31819…
    expect(toUsd("1510.32", "755.16")).toBe("2.00");
    expect(toUsd("0", "755.16")).toBe("0.00");
  });

  it("converts USD to VES rounding half up", () => {
    expect(fromUsd("1", "755.16")).toBe("755.16");
    expect(fromUsd("100", "755.16")).toBe("75516.00");
    expect(fromUsd("0.01", "755.16")).toBe("7.55"); // 7.5516
    expect(fromUsd("1.32", "755.16")).toBe("996.81"); // 996.8112
  });

  it("USD at rate 1 is the identity", () => {
    expect(toUsd("123.45", "1")).toBe("123.45");
    expect(fromUsd("123.45", "1")).toBe("123.45");
  });

  it("applies the half-up edge on the quotient", () => {
    expect(toUsd("1.00", "8")).toBe("0.13"); // 0.125
    expect(toUsd("0.01", "4")).toBe("0.00"); // 0.0025
    expect(toUsd("0.02", "4")).toBe("0.01"); // 0.005
  });

  it("supports 8-decimal rates", () => {
    expect(toUsd("1", "0.00000001")).toBe("100000000.00");
  });

  it("rejects a zero or negative rate", () => {
    expect(() => toUsd("10", "0")).toThrow(RangeError);
    expect(() => toUsd("10", "-1")).toThrow(RangeError);
    expect(() => fromUsd("10", "0")).toThrow(RangeError);
  });
});

describe("isSettled / compareMoney / sign helpers", () => {
  it("is settled at or below 0.01", () => {
    expect(isSettled("0.01")).toBe(true);
    expect(isSettled("0.00")).toBe(true);
    expect(isSettled("-5")).toBe(true);
    expect(isSettled("0.011")).toBe(false);
    expect(isSettled("0.02")).toBe(false);
  });

  it("compares numerically, not lexically", () => {
    expect(compareMoney("9.00", "10.00")).toBe(-1);
    expect(compareMoney("10", "10.00")).toBe(0);
    expect(compareMoney("10.01", "10")).toBe(1);
  });

  it("detects zero and negative", () => {
    expect(isZeroMoney("0.00")).toBe(true);
    expect(isZeroMoney("0.01")).toBe(false);
    expect(isNegativeMoney("-0.01")).toBe(true);
    expect(isNegativeMoney("-0")).toBe(false);
    expect(isNegativeMoney("1")).toBe(false);
  });
});

describe("formatMoney (display only)", () => {
  it("formats USD in en-US and es-VE", () => {
    expect(formatMoney("1234.5", "USD", "en-US")).toBe("$1,234.50");
    expect(formatMoney("1234.5", "USD", "es-VE")).toContain("1.234,50");
  });

  it("rounds half up before formatting", () => {
    expect(formatMoney("1.005", "USD", "en-US")).toBe("$1.01");
  });

  it("keeps full precision of large amounts", () => {
    expect(formatMoney("12345678901234567.89", "USD", "en-US")).toBe("$12,345,678,901,234,567.89");
  });

  it("formats VES", () => {
    expect(formatMoney("75516", "VES", "en-US")).toContain("75,516.00");
  });

  it("formats non-ISO codes as a 2-decimal locale number with the code appended", () => {
    expect(formatMoney("1234.5", "USDT", "en-US")).toBe("1,234.50 USDT");
    expect(formatMoney("1234.5", "USDT", "es-VE")).toBe("1.234,50 USDT");
    expect(formatMoney("1.005", "USDT", "en-US")).toBe("1.01 USDT");
    expect(formatMoney("-0.004", "USDT", "en-US")).toBe("0.00 USDT");
    expect(formatMoney("12345678901234567.89", "USDT", "en-US")).toBe(
      "12,345,678,901,234,567.89 USDT",
    );
  });

  it("does not throw for non-ISO codes with digits or length != 3", () => {
    expect(() => formatMoney("1", "USD1", "en-US")).not.toThrow();
    expect(() => formatMoney("1", "A1", "en-US")).not.toThrow();
  });
});
