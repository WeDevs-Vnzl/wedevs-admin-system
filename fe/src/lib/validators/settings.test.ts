import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/settings.json";
import es from "@/i18n/messages/es/settings.json";
import {
  DEFAULT_FISCAL_SETTINGS,
  DEFAULT_IVA_RATES,
  SETTINGS_MESSAGES,
  companySettingsSchema,
  fiscalSettingsSchema,
  isAllowedIvaRate,
  sameRate,
  settingsDtoSchema,
} from "./settings";

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

describe("settings message keys", () => {
  it("exist in the settings namespace for es and en", () => {
    for (const key of Object.values(SETTINGS_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("fiscal settings (DT-44)", () => {
  it("defaults to rates 16/8/0, default 16, IGTF 3 and 15 due days", () => {
    const parsed = fiscalSettingsSchema.parse({});
    expect(parsed).toEqual(DEFAULT_FISCAL_SETTINGS);
    expect(parsed.ivaRates).toEqual(["16", "8", "0"]);
    expect(parsed.ivaDefaultRate).toBe("16");
    expect(parsed.igtfRate).toBe("3");
    expect(parsed.invoiceDefaultDueDays).toBe(15);
    expect([...DEFAULT_IVA_RATES]).toEqual(parsed.ivaRates);
  });

  it("accepts custom rates and IGTF proposals", () => {
    const parsed = fiscalSettingsSchema.parse({
      ivaRates: ["16", "0"],
      ivaDefaultRate: "0",
      igtfCurrencies: ["USD", "EUR"],
      igtfMethodCodes: ["ZELLE"],
    });
    expect(parsed.igtfCurrencies).toEqual(["USD", "EUR"]);
  });

  it("rejects a default rate outside the allowed list", () => {
    const result = fiscalSettingsSchema.safeParse({ ivaRates: ["16", "0"], ivaDefaultRate: "8" });
    expect(messages(result)).toContain(SETTINGS_MESSAGES.defaultIvaRateNotAllowed);
  });

  it("rejects an empty list, duplicates (numerically) and out-of-range or numeric rates", () => {
    expect(fiscalSettingsSchema.safeParse({ ivaRates: [] }).success).toBe(false);
    const duplicated = fiscalSettingsSchema.safeParse({ ivaRates: ["16", "16.00"] });
    expect(messages(duplicated)).toContain(SETTINGS_MESSAGES.duplicateIvaRate);
    expect(fiscalSettingsSchema.safeParse({ ivaRates: ["16", "101"] }).success).toBe(false);
    expect(fiscalSettingsSchema.safeParse({ ivaRates: [16, 8] }).success).toBe(false);
    expect(fiscalSettingsSchema.safeParse({ igtfRate: 3 }).success).toBe(false);
  });

  it("bounds the due days", () => {
    expect(fiscalSettingsSchema.safeParse({ invoiceDefaultDueDays: 30 }).success).toBe(true);
    expect(fiscalSettingsSchema.safeParse({ invoiceDefaultDueDays: -1 }).success).toBe(false);
    expect(fiscalSettingsSchema.safeParse({ invoiceDefaultDueDays: 366 }).success).toBe(false);
    expect(fiscalSettingsSchema.safeParse({ invoiceDefaultDueDays: 1.5 }).success).toBe(false);
  });

  it("compares rates numerically", () => {
    expect(sameRate("16", "16.00")).toBe(true);
    expect(sameRate("16", "8")).toBe(false);
    expect(sameRate("abc", "16")).toBe(false);
    expect(isAllowedIvaRate("8.00", ["16", "8", "0"])).toBe(true);
    expect(isAllowedIvaRate("12", ["16", "8", "0"])).toBe(false);
  });
});

describe("company settings", () => {
  it("requires a name and normalizes blank optionals", () => {
    const parsed = companySettingsSchema.parse({ name: "WeDevs", legalName: "", taxId: " J-123 " });
    expect(parsed.name).toBe("WeDevs");
    expect(parsed.legalName).toBeUndefined();
    expect(parsed.taxId).toBe("J-123");
    expect(companySettingsSchema.safeParse({ name: " " }).success).toBe(false);
  });

  it("aggregates in the settings DTO", () => {
    const dto = settingsDtoSchema.parse({
      company: { name: "WeDevs", logoFileId: null },
      fiscal: {},
    });
    expect(dto.fiscal.ivaRates).toEqual(["16", "8", "0"]);
  });
});
