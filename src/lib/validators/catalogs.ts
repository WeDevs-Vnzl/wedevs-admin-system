import { z } from "./zod";
import { dateOnlySchema, idSchema, listQuerySchema, VALIDATION_MESSAGES } from "./common";
import { rateSourceSchema } from "./enums";
import { currencyCodeSchema, rateSchema } from "./money";
import { isDecimalString, toDecimal } from "../money";

/**
 * Catalog contracts (PRD §8.15, §9.2, DT-67): currencies, exchange rates (one per date + currency +
 * **source**), quick daily load, CSV import, payment methods and the two-level expense category tree.
 *
 * Also hosts the small helpers shared by the finance contracts (`optionalText`, `facetSchema`,
 * `addUsdRateIssue`, `hexColorSchema`) so each file does not redefine them. Pure and framework-free.
 */

// ───────────────────────────── Validation message keys ─────────────────────────────

/** i18n keys (namespace `catalogs`) used as Zod error messages (C1). */
export const CATALOG_MESSAGES = {
  rateCurrencyIsUsd: "catalogs.validation.rateCurrencyIsUsd",
  duplicateRateCurrency: "catalogs.validation.duplicateRateCurrency",
  invalidColor: "catalogs.validation.invalidColor",
  invalidCode: "catalogs.validation.invalidCode",
  usdRateMustBeOne: "catalogs.validation.usdRateMustBeOne",
  categoryParentIsSelf: "catalogs.validation.categoryParentIsSelf",
} as const;

// ───────────────────────────── Shared helpers of the finance contracts ─────────────────────────────

/** Required trimmed text, 1…`max` characters. */
export function requiredText(max: number) {
  return z.string().trim().min(1, VALIDATION_MESSAGES.required).max(max);
}

/**
 * Optional trimmed text for inputs: an empty or `null` value becomes `undefined`, so forms can send `""`
 * for an empty field.
 */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : undefined));
}

/**
 * Faceted filter value: a single value or a list (the URL carries either), normalized to an array.
 * Used by the module filter schemas that extend `listQuerySchema`.
 */
export function facetSchema<T extends z.ZodType>(item: T) {
  return z
    .union([item, z.array(item)])
    .transform((value): z.output<T>[] => (Array.isArray(value) ? value : [value]) as z.output<T>[])
    .optional();
}

/** `#RGB` or `#RRGGBB` hex color (catalog colors, chart accents). */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, CATALOG_MESSAGES.invalidColor);

/** ISO 8601 UTC timestamp as it travels in DTOs (same shape as `FileDTO.createdAt`). */
export const timestampSchema = z.string();

/** True when a decimal string equals exactly 1 (`"1"`, `"1.0"`, `"1.00000000"`). */
function isOne(value: string): boolean {
  return isDecimalString(value) && toDecimal(value).equals(1);
}

/**
 * USD is always worth exactly 1 USD (PRD §9.2): a `usdRate` other than 1 on a USD transaction is
 * rejected. Call inside `superRefine` once currency and rate parsed; a malformed rate is left to the
 * rate schema.
 */
export function addUsdRateIssue(
  ctx: z.RefinementCtx,
  currency: string,
  usdRate: string,
  path: (string | number)[] = ["usdRate"],
): void {
  if (currency === "USD" && isDecimalString(usdRate) && !isOne(usdRate)) {
    ctx.addIssue({ code: "custom", message: CATALOG_MESSAGES.usdRateMustBeOne, path });
  }
}

const nameSchema = requiredText(120);
const nameEnSchema = optionalText(120);

// ───────────────────────────── Currencies ─────────────────────────────

export const currencyDtoSchema = z.object({
  code: currencyCodeSchema,
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().min(0).max(8),
  active: z.boolean(),
});
export type CurrencyDTO = z.infer<typeof currencyDtoSchema>;

const currencyFields = {
  name: nameSchema,
  symbol: requiredText(8),
  decimals: z.number().int().min(0).max(8).default(2),
  active: z.boolean().default(true),
};

export const createCurrencyInputSchema = z.object({ code: currencyCodeSchema, ...currencyFields });
export type CreateCurrencyInput = z.infer<typeof createCurrencyInputSchema>;

/** The code is the primary key and never changes. */
export const updateCurrencyInputSchema = createCurrencyInputSchema;
export type UpdateCurrencyInput = z.infer<typeof updateCurrencyInputSchema>;

// ───────────────────────────── Exchange rates (DT-67) ─────────────────────────────

/** A rate is "units of the currency per 1 USD", so USD itself never has a row. */
const rateCurrencySchema = currencyCodeSchema.refine((code) => code !== "USD", {
  message: CATALOG_MESSAGES.rateCurrencyIsUsd,
});

export const exchangeRateDtoSchema = z.object({
  id: idSchema,
  date: dateOnlySchema,
  currency: currencyCodeSchema,
  usdRate: rateSchema,
  source: rateSourceSchema,
  createdAt: timestampSchema,
  createdById: idSchema.nullable(),
});
export type ExchangeRateDTO = z.infer<typeof exchangeRateDtoSchema>;

/** `upsertExchangeRate`: unique per date + currency + source, so the same key updates the rate. */
export const upsertExchangeRateInputSchema = z.object({
  date: dateOnlySchema,
  currency: rateCurrencySchema,
  usdRate: rateSchema,
  source: rateSourceSchema.default("MANUAL"),
});
export type UpsertExchangeRateInput = z.infer<typeof upsertExchangeRateInputSchema>;

/** Quick daily load: several currencies for one date and one source (PRD §8.15). */
export const quickRateLoadInputSchema = z
  .object({
    date: dateOnlySchema,
    source: rateSourceSchema.default("MANUAL"),
    rates: z
      .array(z.object({ currency: rateCurrencySchema, usdRate: rateSchema }))
      .min(1, VALIDATION_MESSAGES.required)
      .max(50),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.rates.forEach((row, index) => {
      if (seen.has(row.currency)) {
        ctx.addIssue({
          code: "custom",
          message: CATALOG_MESSAGES.duplicateRateCurrency,
          path: ["rates", index, "currency"],
        });
      }
      seen.add(row.currency);
    });
  });
export type QuickRateLoadInput = z.infer<typeof quickRateLoadInputSchema>;

/** Header of the rates CSV, in order. Labels shown to users come from the `catalogs` namespace. */
export const RATE_CSV_COLUMNS = ["date", "currency", "usdRate", "source"] as const;
export const MAX_RATE_CSV_ROWS = 2000;

/** One CSV row (every cell is text). The currency is upper-cased; a blank source means `MANUAL`. */
export const rateCsvRowSchema = z.object({
  date: dateOnlySchema,
  currency: z.string().trim().toUpperCase().pipe(rateCurrencySchema),
  usdRate: rateSchema,
  source: rateSourceSchema.default("MANUAL"),
});
export type RateCsvRow = z.infer<typeof rateCsvRowSchema>;

export const importRatesCsvInputSchema = z.object({
  rows: z.array(rateCsvRowSchema).min(1, VALIDATION_MESSAGES.required).max(MAX_RATE_CSV_ROWS),
  /** Replace the rate of an existing date + currency + source; otherwise the row is skipped. */
  overwrite: z.boolean().default(false),
});
export type ImportRatesCsvInput = z.infer<typeof importRatesCsvInputSchema>;

export const importRatesCsvResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** 1-based CSV row numbers (header excluded) that failed validation, with i18n message keys. */
  errors: z.array(z.object({ row: z.number().int().min(1), messages: z.array(z.string()) })),
});
export type ImportRatesCsvResult = z.infer<typeof importRatesCsvResultSchema>;

export const exchangeRateFiltersSchema = listQuerySchema.extend({
  currency: facetSchema(currencyCodeSchema),
  source: facetSchema(rateSourceSchema),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
});
export type ExchangeRateFilters = z.infer<typeof exchangeRateFiltersSchema>;

/** `getRateFor(date, currency)` input. */
export const getRateForInputSchema = z.object({
  date: dateOnlySchema,
  currency: currencyCodeSchema,
});
export type GetRateForInput = z.infer<typeof getRateForInputSchema>;

/**
 * `getRateFor` result (PRD §9.2 + DT-67): the rates of the effective date, one per source, for the
 * `RateInput` selector. `effectiveDate` is `null` when there is no rate on or before the date; then
 * `options` is empty and the user types the rate.
 */
export const rateLookupDtoSchema = z.object({
  currency: currencyCodeSchema,
  requestedDate: dateOnlySchema,
  effectiveDate: dateOnlySchema.nullable(),
  /** True when `effectiveDate` is earlier than `requestedDate` ("Usando tasa del dd/mm"). */
  isFallback: z.boolean(),
  options: z.array(
    z.object({
      id: idSchema,
      source: rateSourceSchema,
      usdRate: rateSchema,
      createdAt: timestampSchema,
    }),
  ),
  /** Source preselected: `BCV` when present, else the most recently created. */
  defaultSource: rateSourceSchema.nullable(),
});
export type RateLookupDTO = z.infer<typeof rateLookupDtoSchema>;

// ───────────────────────────── Payment methods ─────────────────────────────

export const paymentMethodDtoSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  requiresReference: z.boolean(),
  suggestsIgtf: z.boolean(),
  active: z.boolean(),
});
export type PaymentMethodDTO = z.infer<typeof paymentMethodDtoSchema>;

const paymentMethodFields = {
  name: nameSchema,
  nameEn: nameEnSchema,
  requiresReference: z.boolean().default(true),
  suggestsIgtf: z.boolean().default(false),
  active: z.boolean().default(true),
};

/** Stable machine code (`ZELLE`, `PAGO_MOVIL`): upper snake case, never edited afterwards. */
export const paymentMethodCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, CATALOG_MESSAGES.invalidCode);

export const createPaymentMethodInputSchema = z.object({
  code: paymentMethodCodeSchema,
  ...paymentMethodFields,
});
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodInputSchema>;

export const updatePaymentMethodInputSchema = z.object({ id: idSchema, ...paymentMethodFields });
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodInputSchema>;

// ───────────────────────────── Expense categories (two levels) ─────────────────────────────

export const expenseCategoryDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
  parentId: idSchema.nullable(),
  active: z.boolean(),
});
export type ExpenseCategoryDTO = z.infer<typeof expenseCategoryDtoSchema>;

/** Root category with its children. Children carry no children: the tree has exactly two levels. */
export const expenseCategoryTreeNodeSchema = expenseCategoryDtoSchema.extend({
  children: z.array(expenseCategoryDtoSchema),
});
export type ExpenseCategoryTreeNode = z.infer<typeof expenseCategoryTreeNodeSchema>;

const expenseCategoryFields = {
  name: nameSchema,
  nameEn: nameEnSchema,
  color: hexColorSchema.nullish().transform((value) => value ?? undefined),
  /** Must be a root category (service rule: depth ≤ 2). `undefined` creates a root. */
  parentId: idSchema.nullish().transform((value) => value ?? undefined),
  active: z.boolean().default(true),
};

export const createExpenseCategoryInputSchema = z.object(expenseCategoryFields);
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategoryInputSchema>;

export const updateExpenseCategoryInputSchema = z
  .object({ id: idSchema, ...expenseCategoryFields })
  .superRefine((input, ctx) => {
    if (input.parentId !== undefined && input.parentId === input.id) {
      ctx.addIssue({
        code: "custom",
        message: CATALOG_MESSAGES.categoryParentIsSelf,
        path: ["parentId"],
      });
    }
  });
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategoryInputSchema>;
