import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/catalogs.json";
import es from "@/i18n/messages/es/catalogs.json";
import { z } from "./zod";
import { VALIDATION_MESSAGES } from "./common";
import {
  CATALOG_MESSAGES,
  MAX_RATE_CSV_ROWS,
  addUsdRateIssue,
  createCurrencyInputSchema,
  createExpenseCategoryInputSchema,
  createPaymentMethodInputSchema,
  exchangeRateDtoSchema,
  exchangeRateFiltersSchema,
  expenseCategoryTreeNodeSchema,
  facetSchema,
  hexColorSchema,
  importRatesCsvInputSchema,
  optionalText,
  quickRateLoadInputSchema,
  rateCsvRowSchema,
  rateLookupDtoSchema,
  updateExpenseCategoryInputSchema,
  upsertExchangeRateInputSchema,
} from "./catalogs";

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

describe("catalog message keys", () => {
  it("exist in the catalogs namespace for es and en", () => {
    for (const key of Object.values(CATALOG_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("currencies", () => {
  it("accepts a valid currency and applies defaults", () => {
    const parsed = createCurrencyInputSchema.parse({ code: "USDT", name: "Tether", symbol: "₮" });
    expect(parsed).toMatchObject({ decimals: 2, active: true });
  });

  it("rejects a bad code and out-of-range decimals", () => {
    expect(
      createCurrencyInputSchema.safeParse({ code: "us", name: "x", symbol: "$" }).success,
    ).toBe(false);
    const result = createCurrencyInputSchema.safeParse({
      code: "USD",
      name: "Dollar",
      symbol: "$",
      decimals: 9,
    });
    expect(result.success).toBe(false);
  });
});

describe("exchange rates (DT-67)", () => {
  const valid = { date: "2026-10-09", currency: "VES", usdRate: "36.54120000" };

  it("accepts a rate and defaults the source to MANUAL", () => {
    expect(upsertExchangeRateInputSchema.parse(valid).source).toBe("MANUAL");
    expect(upsertExchangeRateInputSchema.parse({ ...valid, source: "BCV" }).source).toBe("BCV");
  });

  it("rejects numbers, zero, negative and more than 8 decimals (rates > 0)", () => {
    expect(upsertExchangeRateInputSchema.safeParse({ ...valid, usdRate: 36.5 }).success).toBe(
      false,
    );
    for (const usdRate of ["0", "0.00", "-1", "1.123456789"]) {
      expect(upsertExchangeRateInputSchema.safeParse({ ...valid, usdRate }).success, usdRate).toBe(
        false,
      );
    }
  });

  it("rejects an unknown source and a rate for USD", () => {
    expect(upsertExchangeRateInputSchema.safeParse({ ...valid, source: "OTHER" }).success).toBe(
      false,
    );
    expect(
      messages(upsertExchangeRateInputSchema.safeParse({ ...valid, currency: "USD" })),
    ).toContain(CATALOG_MESSAGES.rateCurrencyIsUsd);
  });

  it("rejects an invalid date", () => {
    expect(upsertExchangeRateInputSchema.safeParse({ ...valid, date: "2026-02-30" }).success).toBe(
      false,
    );
  });

  it("DTO carries the source", () => {
    const dto = {
      id: "r1",
      ...valid,
      source: "BCV",
      createdAt: "2026-10-09T10:00:00Z",
      createdById: null,
    };
    expect(exchangeRateDtoSchema.safeParse(dto).success).toBe(true);
    expect(exchangeRateDtoSchema.safeParse({ ...dto, source: undefined }).success).toBe(false);
  });

  it("lookup DTO lists one option per source with a default", () => {
    const lookup = {
      currency: "VES",
      requestedDate: "2026-10-09",
      effectiveDate: "2026-10-08",
      isFallback: true,
      options: [
        { id: "r1", source: "BCV", usdRate: "36.5", createdAt: "2026-10-08T10:00:00Z" },
        { id: "r2", source: "MANUAL", usdRate: "37", createdAt: "2026-10-08T11:00:00Z" },
      ],
      defaultSource: "BCV",
    };
    expect(rateLookupDtoSchema.safeParse(lookup).success).toBe(true);
  });
});

describe("quick daily load", () => {
  it("accepts several currencies for one date and source", () => {
    const parsed = quickRateLoadInputSchema.parse({
      date: "2026-10-09",
      rates: [
        { currency: "VES", usdRate: "36.5" },
        { currency: "EUR", usdRate: "0.92" },
      ],
    });
    expect(parsed.source).toBe("MANUAL");
  });

  it("rejects an empty load and repeated currencies", () => {
    expect(quickRateLoadInputSchema.safeParse({ date: "2026-10-09", rates: [] }).success).toBe(
      false,
    );
    const repeated = quickRateLoadInputSchema.safeParse({
      date: "2026-10-09",
      rates: [
        { currency: "VES", usdRate: "36.5" },
        { currency: "VES", usdRate: "36.6" },
      ],
    });
    expect(messages(repeated)).toContain(CATALOG_MESSAGES.duplicateRateCurrency);
  });
});

describe("CSV import row", () => {
  it("upper-cases the currency and defaults the source", () => {
    const row = rateCsvRowSchema.parse({ date: "2026-10-09", currency: " ves ", usdRate: "36.5" });
    expect(row).toEqual({
      date: "2026-10-09",
      currency: "VES",
      usdRate: "36.5",
      source: "MANUAL",
    });
  });

  it("rejects a bad row", () => {
    expect(
      rateCsvRowSchema.safeParse({ date: "09/10/2026", currency: "VES", usdRate: "36" }).success,
    ).toBe(false);
    expect(
      rateCsvRowSchema.safeParse({ date: "2026-10-09", currency: "VES", usdRate: "0" }).success,
    ).toBe(false);
    expect(
      rateCsvRowSchema.safeParse({ date: "2026-10-09", currency: "USD", usdRate: "1" }).success,
    ).toBe(false);
  });

  it("bounds the number of rows", () => {
    const row = { date: "2026-10-09", currency: "VES", usdRate: "36.5" };
    expect(importRatesCsvInputSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(importRatesCsvInputSchema.safeParse({ rows: [row] }).success).toBe(true);
    const tooMany = Array.from({ length: MAX_RATE_CSV_ROWS + 1 }, () => row);
    expect(importRatesCsvInputSchema.safeParse({ rows: tooMany }).success).toBe(false);
  });
});

describe("rate filters", () => {
  it("extends the list query and normalizes facets to arrays", () => {
    const parsed = exchangeRateFiltersSchema.parse({ currency: "VES", source: ["BCV", "MANUAL"] });
    expect(parsed.currency).toEqual(["VES"]);
    expect(parsed.source).toEqual(["BCV", "MANUAL"]);
    expect(parsed.page).toBe(1);
  });
});

describe("payment methods", () => {
  it("accepts a method and defaults the flags", () => {
    const parsed = createPaymentMethodInputSchema.parse({ code: "ZELLE", name: "Zelle" });
    expect(parsed).toMatchObject({ requiresReference: true, suggestsIgtf: false, active: true });
  });

  it("rejects lower-case codes and blank names", () => {
    expect(createPaymentMethodInputSchema.safeParse({ code: "zelle", name: "Zelle" }).success).toBe(
      false,
    );
    expect(createPaymentMethodInputSchema.safeParse({ code: "ZELLE", name: "  " }).success).toBe(
      false,
    );
  });
});

describe("expense categories (two levels)", () => {
  it("accepts a root and a child", () => {
    expect(createExpenseCategoryInputSchema.safeParse({ name: "Infraestructura" }).success).toBe(
      true,
    );
    const child = createExpenseCategoryInputSchema.parse({
      name: "Hosting",
      parentId: "cat-infra",
      color: "#336699",
    });
    expect(child.parentId).toBe("cat-infra");
  });

  it("rejects a bad color and a category that is its own parent", () => {
    expect(hexColorSchema.safeParse("blue").success).toBe(false);
    expect(createExpenseCategoryInputSchema.safeParse({ name: "x", color: "red" }).success).toBe(
      false,
    );
    const self = updateExpenseCategoryInputSchema.safeParse({
      id: "c1",
      name: "x",
      parentId: "c1",
    });
    expect(messages(self)).toContain(CATALOG_MESSAGES.categoryParentIsSelf);
  });

  it("tree children cannot nest further", () => {
    const leaf = {
      id: "c2",
      name: "Hosting",
      nameEn: null,
      color: null,
      parentId: "c1",
      active: true,
    };
    const root = {
      id: "c1",
      name: "Infra",
      nameEn: null,
      color: null,
      parentId: null,
      active: true,
    };
    expect(
      expenseCategoryTreeNodeSchema.parse({ ...root, children: [leaf] }).children,
    ).toHaveLength(1);
    // A grandchild is stripped: children are plain categories, not nodes.
    const nested = expenseCategoryTreeNodeSchema.parse({
      ...root,
      children: [{ ...leaf, children: [leaf] }],
    });
    expect("children" in (nested.children[0] ?? {})).toBe(false);
  });
});

describe("shared helpers", () => {
  it("optionalText turns blank and null into undefined", () => {
    const schema = optionalText(5);
    expect(schema.parse("")).toBeUndefined();
    expect(schema.parse("  ")).toBeUndefined();
    expect(schema.parse(null)).toBeUndefined();
    expect(schema.parse(" ab ")).toBe("ab");
    expect(schema.safeParse("abcdef").success).toBe(false);
  });

  it("facetSchema accepts one value or a list", () => {
    const schema = facetSchema(z.enum(["A", "B"]));
    expect(schema.parse("A")).toEqual(["A"]);
    expect(schema.parse(["A", "B"])).toEqual(["A", "B"]);
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.safeParse("C").success).toBe(false);
  });

  it("addUsdRateIssue forces rate 1 on USD only", () => {
    const schema = z
      .object({ currency: z.string(), usdRate: z.string() })
      .superRefine((input, ctx) => addUsdRateIssue(ctx, input.currency, input.usdRate));
    expect(schema.safeParse({ currency: "USD", usdRate: "1" }).success).toBe(true);
    expect(schema.safeParse({ currency: "USD", usdRate: "1.00" }).success).toBe(true);
    expect(messages(schema.safeParse({ currency: "USD", usdRate: "36" }))).toEqual([
      CATALOG_MESSAGES.usdRateMustBeOne,
    ]);
    expect(schema.safeParse({ currency: "VES", usdRate: "36" }).success).toBe(true);
  });

  it("uses validation keys, not prose, for required text", () => {
    const result = createCurrencyInputSchema.safeParse({ code: "USD", name: "", symbol: "$" });
    expect(messages(result)).toContain(VALIDATION_MESSAGES.required);
  });
});
