"use server";

import {
  createCurrencyInputSchema,
  createExpenseCategoryInputSchema,
  createPaymentMethodInputSchema,
  exchangeRateFiltersSchema,
  getRateForInputSchema,
  importRatesCsvInputSchema,
  quickRateLoadInputSchema,
  updateCurrencyInputSchema,
  updateExpenseCategoryInputSchema,
  updatePaymentMethodInputSchema,
  upsertExchangeRateInputSchema,
} from "@/lib/validators/catalogs";
import { updateFiscalSettingsInputSchema } from "@/lib/validators/settings";
import * as catalogs from "@/mocks/services/catalogs";
import { defineAction } from "@/server/actions/define-action";

/**
 * Read action behind `RateInput` (DT-67): the rate to prefill for a currency on a date, with every usable
 * rate of the effective date as `options`. `SelectedRate | null`: `null` means the user types the rate.
 * Exchange rates are reference data, so any signed-in role may ask.
 */
export const lookupRateAction = defineAction({
  permission: "authenticated",
  input: getRateForInputSchema,
  handler: (ctx, data) => catalogs.getRateFor(ctx, data),
});

// ───────────────────────────── Settings writes (Owner and Admin, `settings` row) ─────────────────────────────

const PATHS = {
  currencies: "/settings/currencies",
  rates: "/settings/rates",
  fiscal: "/settings/fiscal",
  paymentMethods: "/settings/payment-methods",
  expenseCategories: "/settings/expense-categories",
} as const;

export const createCurrencyAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: createCurrencyInputSchema,
  revalidate: [PATHS.currencies],
  handler: (ctx, data) => catalogs.createCurrency(ctx, data),
});

/** Edits a currency, incl. activating or deactivating it (C19: catalogs are retired, never deleted). */
export const updateCurrencyAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateCurrencyInputSchema,
  revalidate: [PATHS.currencies],
  handler: (ctx, data) => catalogs.updateCurrency(ctx, data),
});

/** Settings → Tasas table: the rows of one page (the table refreshes through it on a query change). */
export const listExchangeRatesAction = defineAction({
  permission: { action: "read", resource: "settings" },
  input: exchangeRateFiltersSchema,
  handler: (ctx, data) => catalogs.listExchangeRates(ctx, data),
});

export const upsertExchangeRateAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: upsertExchangeRateInputSchema,
  revalidate: [PATHS.rates],
  handler: (ctx, data) => catalogs.upsertExchangeRate(ctx, data),
});

/** Quick daily load (PRD §8.15): several currencies for one date and source. */
export const loadDailyRatesAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: quickRateLoadInputSchema,
  revalidate: [PATHS.rates],
  handler: (ctx, data) => catalogs.loadDailyRates(ctx, data),
});

/** CSV import: the client parses the file (`rates-csv.ts`) and sends the valid rows. */
export const importRatesCsvAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: importRatesCsvInputSchema,
  revalidate: [PATHS.rates],
  handler: (ctx, data) => catalogs.importRatesCsv(ctx, data),
});

export const updateFiscalSettingsAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateFiscalSettingsInputSchema,
  revalidate: [PATHS.fiscal],
  handler: (ctx, data) => catalogs.updateFiscalSettings(ctx, data),
});

export const createPaymentMethodAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: createPaymentMethodInputSchema,
  revalidate: [PATHS.paymentMethods],
  handler: (ctx, data) => catalogs.createPaymentMethod(ctx, data),
});

export const updatePaymentMethodAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updatePaymentMethodInputSchema,
  revalidate: [PATHS.paymentMethods],
  handler: (ctx, data) => catalogs.updatePaymentMethod(ctx, data),
});

export const createExpenseCategoryAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: createExpenseCategoryInputSchema,
  revalidate: [PATHS.expenseCategories],
  handler: (ctx, data) => catalogs.createExpenseCategory(ctx, data),
});

export const updateExpenseCategoryAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateExpenseCategoryInputSchema,
  revalidate: [PATHS.expenseCategories],
  handler: (ctx, data) => catalogs.updateExpenseCategory(ctx, data),
});
