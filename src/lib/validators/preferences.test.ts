import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  parseTableColumnsKey,
  preferenceKeySchema,
  resetPreferenceInputSchema,
  setPreferenceInputSchema,
  tableColumnsKey,
  tableColumnsPreferenceSchema,
  tableIdSchema,
  userPreferencesSchema,
} from "./preferences";

describe("timezone (DT-43)", () => {
  it("defaults to America/Caracas, which is a real zone", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Caracas");
    expect(isValidTimezone(DEFAULT_TIMEZONE)).toBe(true);
  });

  it("rejects unknown or empty zones", () => {
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("x".repeat(100))).toBe(false);
  });
});

describe("table column keys", () => {
  it("builds and parses table:<id>:columns", () => {
    expect(tableColumnsKey("clients")).toBe("table:clients:columns");
    expect(parseTableColumnsKey("table:project-links:columns")).toBe("project-links");
    expect(parseTableColumnsKey("table:Bad Id:columns")).toBeNull();
    expect(parseTableColumnsKey("locale")).toBeNull();
  });

  it("table ids are lower-case kebab", () => {
    expect(tableIdSchema.safeParse("clients").success).toBe(true);
    for (const bad of ["Clients", "a_b", "-a", "a--b", ""]) {
      expect(tableIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts the four key families and nothing else", () => {
    for (const key of ["locale", "theme", "timezone", "table:invoices:columns"]) {
      expect(preferenceKeySchema.safeParse(key).success, key).toBe(true);
    }
    for (const key of ["language", "table:invoices:filters", "table::columns", "table:X:columns"]) {
      expect(preferenceKeySchema.safeParse(key).success, key).toBe(false);
    }
  });
});

describe("column preference value", () => {
  it("fills defaults and validates widths and ids", () => {
    expect(tableColumnsPreferenceSchema.parse({})).toEqual({
      order: [],
      visibility: {},
      widths: {},
    });
    expect(
      tableColumnsPreferenceSchema.safeParse({
        order: ["code", "tradeName"],
        visibility: { tags: false },
        widths: { code: 120 },
      }).success,
    ).toBe(true);
    expect(tableColumnsPreferenceSchema.safeParse({ order: ["a", "a"] }).success).toBe(false);
    expect(tableColumnsPreferenceSchema.safeParse({ widths: { code: 10 } }).success).toBe(false);
    expect(tableColumnsPreferenceSchema.safeParse({ widths: { code: 12.5 } }).success).toBe(false);
    expect(tableColumnsPreferenceSchema.safeParse({ order: ["1bad"] }).success).toBe(false);
  });
});

describe("setPreference", () => {
  it("accepts the value each key allows", () => {
    for (const input of [
      { key: "locale", value: "en" },
      { key: "theme", value: "dark" },
      { key: "timezone", value: "America/Caracas" },
      { key: "table:clients:columns", value: { order: ["code"] } },
    ]) {
      expect(setPreferenceInputSchema.safeParse(input).success, input.key).toBe(true);
    }
  });

  it("rejects a value the key does not allow", () => {
    for (const input of [
      { key: "locale", value: "fr" },
      { key: "theme", value: "blue" },
      { key: "timezone", value: "Nowhere/City" },
      { key: "table:clients:columns", value: "wide" },
      { key: "unknown", value: "x" },
    ]) {
      expect(setPreferenceInputSchema.safeParse(input).success, input.key).toBe(false);
    }
  });

  it("resetPreference takes any valid key", () => {
    expect(resetPreferenceInputSchema.safeParse({ key: "table:clients:columns" }).success).toBe(
      true,
    );
    expect(resetPreferenceInputSchema.safeParse({ key: "nope" }).success).toBe(false);
  });
});

describe("UserPreferencesDTO", () => {
  it("round-trips a full preference set", () => {
    const value = {
      locale: "es",
      theme: "system",
      timezone: "America/Caracas",
      tableColumns: { clients: { order: ["code"], visibility: {}, widths: {} } },
    };
    expect(userPreferencesSchema.parse(value)).toEqual(value);
  });
});
