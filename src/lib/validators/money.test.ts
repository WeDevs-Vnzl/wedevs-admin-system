import { describe, expect, it } from "vitest";
import { VALIDATION_MESSAGES } from "./common";
import {
  currencyCodeSchema,
  moneyAmountSchema,
  moneyDtoSchema,
  percentSchema,
  rateSchema,
} from "./money";

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("moneyAmountSchema", () => {
  const positive = moneyAmountSchema();

  it.each(["0.01", "1", "12.5", "755.16", "9999999999999999.99", "100"])("accepts %s", (v) => {
    expect(positive.safeParse(v).success).toBe(true);
  });

  it("rejects numbers (C15): money is never a JS number", () => {
    for (const value of [12, 12.5, 0, NaN]) {
      expect(positive.safeParse(value).success).toBe(false);
      expect(moneyAmountSchema({ sign: "any" }).safeParse(value).success).toBe(false);
    }
    expect(positive.safeParse(null).success).toBe(false);
    expect(positive.safeParse(undefined).success).toBe(false);
  });

  it.each(["1.234", "0.001", "10.999"])("rejects more than 2 decimals: %s", (v) => {
    expect(firstMessage(positive.safeParse(v))).toBe(VALIDATION_MESSAGES.moneyTooManyDecimals);
  });

  it.each(["10000000000000000", "10000000000000000.00", "99999999999999999.99"])(
    "rejects out of Decimal(18,2) range: %s",
    (v) => {
      expect(firstMessage(positive.safeParse(v))).toBe(VALIDATION_MESSAGES.moneyOutOfRange);
    },
  );

  it.each([
    "",
    " ",
    "abc",
    "1,000.00",
    "1e3",
    "+5",
    " 5",
    "5 ",
    ".5",
    "5.",
    "007",
    "--1",
    "1.2.3",
    "NaN",
    "Infinity",
    "-",
  ])("rejects malformed %j", (v) => {
    expect(firstMessage(positive.safeParse(v))).toBe(VALIDATION_MESSAGES.invalidMoney);
  });

  it("rejects negative zero", () => {
    expect(moneyAmountSchema({ sign: "any" }).safeParse("-0").success).toBe(false);
    expect(moneyAmountSchema({ sign: "any" }).safeParse("-0.00").success).toBe(false);
  });

  describe("sign rules", () => {
    it("positive (default): > 0 only", () => {
      expect(positive.safeParse("0").success).toBe(false);
      expect(positive.safeParse("0.00").success).toBe(false);
      expect(positive.safeParse("-1").success).toBe(false);
      expect(firstMessage(positive.safeParse("0.00"))).toBe(
        VALIDATION_MESSAGES.moneyMustBePositive,
      );
    });

    it("nonNegative: zero allowed, negatives rejected", () => {
      const schema = moneyAmountSchema({ sign: "nonNegative" });
      expect(schema.safeParse("0").success).toBe(true);
      expect(schema.safeParse("0.00").success).toBe(true);
      expect(schema.safeParse("5.50").success).toBe(true);
      expect(firstMessage(schema.safeParse("-0.01"))).toBe(
        VALIDATION_MESSAGES.moneyMustBeNonNegative,
      );
    });

    it("any: signed values allowed within range", () => {
      const schema = moneyAmountSchema({ sign: "any" });
      expect(schema.safeParse("-1234.56").success).toBe(true);
      expect(schema.safeParse("0").success).toBe(true);
      expect(schema.safeParse("-9999999999999999.99").success).toBe(true);
      expect(schema.safeParse("-10000000000000000").success).toBe(false);
    });
  });
});

describe("rateSchema", () => {
  it.each(["1", "755.16", "0.00000001", "36.5", "123456789012.12345678", "1.10000000"])(
    "accepts %s",
    (v) => {
      expect(rateSchema.safeParse(v).success).toBe(true);
    },
  );

  it.each(["0", "0.0", "0.00000000"])("rejects zero: %s", (v) => {
    expect(firstMessage(rateSchema.safeParse(v))).toBe(VALIDATION_MESSAGES.rateMustBePositive);
  });

  it("rejects negatives, numbers and malformed values", () => {
    expect(rateSchema.safeParse("-1").success).toBe(false);
    expect(rateSchema.safeParse(1).success).toBe(false);
    expect(rateSchema.safeParse("1e5").success).toBe(false);
    expect(rateSchema.safeParse("").success).toBe(false);
    expect(rateSchema.safeParse("1,5").success).toBe(false);
  });

  it("rejects more than 8 decimals and out-of-range values", () => {
    expect(firstMessage(rateSchema.safeParse("1.123456789"))).toBe(
      VALIDATION_MESSAGES.rateTooManyDecimals,
    );
    expect(firstMessage(rateSchema.safeParse("1000000000000"))).toBe(
      VALIDATION_MESSAGES.rateOutOfRange,
    );
  });
});

describe("percentSchema", () => {
  it.each(["0", "0.00", "8", "16", "16.5", "99.99", "100", "100.00"])("accepts %s", (v) => {
    expect(percentSchema.safeParse(v).success).toBe(true);
  });

  it.each(["100.01", "101", "1000", "-1", "-0.01"])("rejects out of 0–100: %s", (v) => {
    expect(percentSchema.safeParse(v).success).toBe(false);
  });

  it("rejects more than 2 decimals, numbers and malformed values", () => {
    expect(firstMessage(percentSchema.safeParse("16.123"))).toBe(
      VALIDATION_MESSAGES.percentTooManyDecimals,
    );
    expect(percentSchema.safeParse(16).success).toBe(false);
    expect(percentSchema.safeParse("16%").success).toBe(false);
    expect(percentSchema.safeParse("").success).toBe(false);
    expect(percentSchema.safeParse("016").success).toBe(false);
  });
});

describe("currencyCodeSchema and moneyDtoSchema", () => {
  it.each(["USD", "VES", "EUR", "USDT", "COP"])("accepts %s", (v) => {
    expect(currencyCodeSchema.safeParse(v).success).toBe(true);
  });

  it.each(["usd", "US", "", "U$D", "USD ", "1USD", "TOOLONGCODE1"])("rejects %j", (v) => {
    expect(currencyCodeSchema.safeParse(v).success).toBe(false);
  });

  it("MoneyDTO carries a signed decimal string and a currency", () => {
    expect(moneyDtoSchema.parse({ amount: "-12.50", currency: "USD" })).toEqual({
      amount: "-12.50",
      currency: "USD",
    });
    expect(moneyDtoSchema.safeParse({ amount: 12.5, currency: "USD" }).success).toBe(false);
  });
});
