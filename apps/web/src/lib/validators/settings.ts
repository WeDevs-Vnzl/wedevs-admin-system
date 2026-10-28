import { z } from "./zod";
import { idSchema, VALIDATION_MESSAGES } from "./common";
import { currencyCodeSchema, percentSchema } from "./money";
import { optionalText, requiredText } from "./catalogs";
import { isDecimalString, toDecimal } from "../money";

/**
 * Settings contracts (PRD §8.15, DT-44): company profile and fiscal parameters. Fiscal carries the
 * **list of allowed VAT rates** (`ivaRates`) and the default one, which invoice lines pick from.
 * The VAT figures are configurable parameters to validate with the accountant (PRD §9.8).
 */

export const SETTINGS_MESSAGES = {
  duplicateIvaRate: "settings.validation.duplicateIvaRate",
  defaultIvaRateNotAllowed: "settings.validation.defaultIvaRateNotAllowed",
} as const;

/** Keys of the `Setting` table (PRD §10.2 `Setting.key`). */
export const SETTING_KEYS = {
  company: "company",
  fiscal: "fiscal",
  invoiceDefaultDueDays: "invoice.defaultDueDays",
} as const;

export const DEFAULT_IVA_RATES = ["16", "8", "0"] as const;
export const DEFAULT_IVA_RATE = "16";
export const DEFAULT_IGTF_RATE = "3";
export const DEFAULT_INVOICE_DUE_DAYS = 15;

/** Numeric equality between two percentage strings (`"16"` equals `"16.00"`). */
export function sameRate(a: string, b: string): boolean {
  return isDecimalString(a) && isDecimalString(b) && toDecimal(a).equals(toDecimal(b));
}

/** True when `rate` is one of `allowed`, compared numerically. */
export function isAllowedIvaRate(rate: string, allowed: readonly string[]): boolean {
  return allowed.some((candidate) => sameRate(rate, candidate));
}

// ───────────────────────────── Company ─────────────────────────────

export const companySettingsSchema = z.object({
  name: requiredText(120),
  legalName: optionalText(160),
  /** RIF as written by the company. */
  taxId: optionalText(30),
  address: optionalText(300),
  /** Logo used by the portal and print views (a `File`). */
  logoFileId: idSchema.nullish().transform((value) => value ?? undefined),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;
export const updateCompanySettingsInputSchema = companySettingsSchema;
export type UpdateCompanySettingsInput = CompanySettings;

/**
 * Company settings services (A1; PRD §8.15 "Empresa"). Every service is `fn(ctx, input) → Promise<DTO>`
 * (C9, C11); the read takes no input, like the fiscal one.
 */
export type CompanySettingsService<Ctx = unknown> = {
  getCompanySettings: (ctx: Ctx) => Promise<CompanySettings>;
  updateCompanySettings: (ctx: Ctx, input: UpdateCompanySettingsInput) => Promise<CompanySettings>;
};

// ───────────────────────────── Fiscal ─────────────────────────────

const ivaRatesSchema = z
  .array(percentSchema)
  .min(1, VALIDATION_MESSAGES.required)
  .max(10)
  .superRefine((rates, ctx) => {
    rates.forEach((rate, index) => {
      if (rates.findIndex((other) => sameRate(other, rate)) !== index) {
        ctx.addIssue({
          code: "custom",
          message: SETTINGS_MESSAGES.duplicateIvaRate,
          path: [index],
        });
      }
    });
  });

const fiscalFields = {
  /** Allowed VAT rates for invoice lines (default `["16", "8", "0"]`). */
  ivaRates: ivaRatesSchema.default([...DEFAULT_IVA_RATES]),
  /** Preselected rate of a new line; must be one of `ivaRates`. */
  ivaDefaultRate: percentSchema.default(DEFAULT_IVA_RATE),
  igtfRate: percentSchema.default(DEFAULT_IGTF_RATE),
  /** Currencies that propose IGTF on a payment (PRD §8.15). */
  igtfCurrencies: z.array(currencyCodeSchema).max(20).default([]),
  /** Payment method codes that propose IGTF (complements `PaymentMethod.suggestsIgtf`). */
  igtfMethodCodes: z.array(z.string().min(1).max(40)).max(30).default([]),
  /** Days added to the issue date to get the default due date (DT-44). */
  invoiceDefaultDueDays: z.number().int().min(0).max(365).default(DEFAULT_INVOICE_DUE_DAYS),
};

export const fiscalSettingsSchema = z.object(fiscalFields).superRefine((input, ctx) => {
  if (!isAllowedIvaRate(input.ivaDefaultRate, input.ivaRates)) {
    ctx.addIssue({
      code: "custom",
      message: SETTINGS_MESSAGES.defaultIvaRateNotAllowed,
      path: ["ivaDefaultRate"],
    });
  }
});
export type FiscalSettings = z.infer<typeof fiscalSettingsSchema>;
export const updateFiscalSettingsInputSchema = fiscalSettingsSchema;
export type UpdateFiscalSettingsInput = FiscalSettings;

export const DEFAULT_FISCAL_SETTINGS: FiscalSettings = {
  ivaRates: [...DEFAULT_IVA_RATES],
  ivaDefaultRate: DEFAULT_IVA_RATE,
  igtfRate: DEFAULT_IGTF_RATE,
  igtfCurrencies: [],
  igtfMethodCodes: [],
  invoiceDefaultDueDays: DEFAULT_INVOICE_DUE_DAYS,
};

// ───────────────────────────── Aggregate ─────────────────────────────

export const settingsDtoSchema = z.object({
  company: companySettingsSchema,
  fiscal: fiscalSettingsSchema,
});
export type SettingsDTO = z.infer<typeof settingsDtoSchema>;
