import { z } from "./zod";
import {
  dateOnlySchema,
  facetOf,
  hexColorSchema,
  idSchema,
  listQuerySchema,
  optionalText,
  requiredText,
  timestampSchema,
  VALIDATION_MESSAGES,
  withSortFields,
} from "./common";
import { rateSourceSchema } from "./enums";
import { currencyCodeSchema, rateSchema } from "./money";
import { isDecimalString, toDecimal } from "../money";
import type { SelectedRate } from "../rates";

/**
 * Catalog contracts (PRD §8.15, §9.2, DT-67): currencies, exchange rates (one per date + currency +
 * **source**), quick daily load, CSV import, payment methods and the two-level expense category tree.
 *
 * Also re-exports the shared helpers the finance contracts import from here (`requiredText`,
 * `optionalText`, `facetSchema`, `hexColorSchema`, `timestampSchema`; defined once in `common.ts`) and
 * hosts `addUsdRateIssue`. Pure and framework-free.
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

// One behaviour each, defined in `common.ts`; kept importable from here under their historical names.
export { optionalText, requiredText, timestampSchema, hexColorSchema };

/**
 * Faceted filter value: a single value or a list (the URL carries either), normalized to an array
 * (`undefined` when not set). Alias of `facetOf`.
 */
export const facetSchema = facetOf;

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

export const EXCHANGE_RATE_SORT_FIELDS = [
  "date",
  "currency",
  "usdRate",
  "source",
  "createdAt",
] as const;

export const exchangeRateFiltersSchema = withSortFields(
  listQuerySchema.extend({
    currency: facetSchema(currencyCodeSchema),
    source: facetSchema(rateSourceSchema),
    dateFrom: dateOnlySchema.optional(),
    dateTo: dateOnlySchema.optional(),
  }),
  EXCHANGE_RATE_SORT_FIELDS,
);
export type ExchangeRateFilters = z.infer<typeof exchangeRateFiltersSchema>;

/** `getRateFor(date, currency)` input. */
export const getRateForInputSchema = z.object({
  date: dateOnlySchema,
  currency: currencyCodeSchema,
});
export type GetRateForInput = z.infer<typeof getRateForInputSchema>;

/**
 * `getRateFor` result (PRD §9.2 + DT-67): the rates of the effective date, one per source, for the
 * `RateInput` selector. Same shape as `SelectedRate` (`lib/rates`); a missing rate (no rate on or before
 * the date) is `null` for the whole result, not a nullable date, and the user types the rate. USD is
 * `{ usdRate: "1", source: null, isFallback: false, options: [] }`.
 */
export const rateLookupDtoSchema = z.object({
  /** Units of the currency per 1 USD; equals `options[0].usdRate` outside USD. */
  usdRate: rateSchema,
  /** Source of `usdRate` (`options[0]`: `BCV` when present, else the latest created); `null` for USD. */
  source: rateSourceSchema.nullable(),
  /** True when `effectiveDate` is earlier than the requested date ("Usando tasa del dd/mm"). */
  isFallback: z.boolean(),
  effectiveDate: dateOnlySchema,
  /** Every usable rate of `effectiveDate`, default first; empty for USD. */
  options: z.array(
    z.object({
      source: rateSourceSchema,
      usdRate: rateSchema,
      createdAt: timestampSchema,
    }),
  ),
});
export type RateLookupDTO = z.infer<typeof rateLookupDtoSchema>;

/** Compile-time check: the DTO and `lib/rates` `SelectedRate` stay mutually assignable. */
type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type RateLookupMatchesSelectedRate = Assert<Mutual<RateLookupDTO, SelectedRate>>;

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

// ───────────────────────────── List inputs (m-g) ─────────────────────────────

/**
 * Input of the simple catalog lists (currencies, payment methods, expense categories). Pickers get the
 * active rows only (the default); the Settings screens ask for every row with `includeInactive: true`.
 * Technologies and document types keep their own filter schemas (`active` facet).
 */
const catalogListShape = {
  includeInactive: z.union([z.boolean(), z.stringbool()]).default(false),
};

export const currencyListInputSchema = z.object(catalogListShape);
export type CurrencyListInput = z.infer<typeof currencyListInputSchema>;
export type CurrencyListInputRaw = z.input<typeof currencyListInputSchema>;

export const paymentMethodListInputSchema = z.object(catalogListShape);
export type PaymentMethodListInput = z.infer<typeof paymentMethodListInputSchema>;
export type PaymentMethodListInputRaw = z.input<typeof paymentMethodListInputSchema>;

export const expenseCategoryListInputSchema = z.object(catalogListShape);
export type ExpenseCategoryListInput = z.infer<typeof expenseCategoryListInputSchema>;
export type ExpenseCategoryListInputRaw = z.input<typeof expenseCategoryListInputSchema>;
