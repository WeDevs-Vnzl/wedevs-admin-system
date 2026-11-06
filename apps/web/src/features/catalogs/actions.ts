"use server";

import { apiAction } from "@/lib/api/action";
import {
  exchangeRateFiltersSchema,
  getRateForInputSchema,
  importRatesCsvInputSchema,
  quickRateLoadInputSchema,
  upsertExchangeRateInputSchema,
  createCurrencyInputSchema,
  createExpenseCategoryInputSchema,
  createPaymentMethodInputSchema,
  updateCurrencyInputSchema,
  updateExpenseCategoryInputSchema,
  updatePaymentMethodInputSchema,
} from "@/lib/validators/catalogs";
import type { updateFiscalSettingsInputSchema } from "@/lib/validators/settings";
import type { z } from "@/lib/validators/zod";
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

// Action inputs are the forms' schema inputs (defaults optional): the schemas validate for UX, the BE decides.
type CreateCurrencyInput = z.input<typeof createCurrencyInputSchema>;
type UpdateCurrencyInput = z.input<typeof updateCurrencyInputSchema>;
type CreatePaymentMethodInput = z.input<typeof createPaymentMethodInputSchema>;
type UpdatePaymentMethodInput = z.input<typeof updatePaymentMethodInputSchema>;
type CreateExpenseCategoryInput = z.input<typeof createExpenseCategoryInputSchema>;
type UpdateExpenseCategoryInput = z.input<typeof updateExpenseCategoryInputSchema>;
type UpdateFiscalSettingsInput = z.input<typeof updateFiscalSettingsInputSchema>;

const PATHS = {
  currencies: "/settings/currencies",
  rates: "/settings/rates",
  fiscal: "/settings/fiscal",
  paymentMethods: "/settings/payment-methods",
  expenseCategories: "/settings/expense-categories",
} as const;

export const createCurrencyAction = apiAction({
  call: (input: CreateCurrencyInput, api) => api.POST("/api/v1/currencies", { body: input }),
  revalidate: [PATHS.currencies],
});

/** Edits a currency, incl. activating or deactivating it (C19: catalogs are retired, never deleted). */
export const updateCurrencyAction = apiAction({
  call: ({ code, ...body }: UpdateCurrencyInput, api) =>
    api.PATCH("/api/v1/currencies/{code}", { params: { path: { code } }, body }),
  revalidate: [PATHS.currencies],
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

/** Fiscal rates and amounts stay decimal strings (C15); the BE keeps no per-method IGTF code list. */
export const updateFiscalSettingsAction = apiAction({
  call: (input: UpdateFiscalSettingsInput, api) =>
    api.PATCH("/api/v1/settings/fiscal", {
      body: {
        ivaRates: input.ivaRates,
        ivaDefaultRate: input.ivaDefaultRate,
        igtfRate: input.igtfRate,
        igtfCurrencies: input.igtfCurrencies,
        invoiceDefaultDueDays: input.invoiceDefaultDueDays,
      },
    }),
  revalidate: [PATHS.fiscal],
});

export const createPaymentMethodAction = apiAction({
  call: (input: CreatePaymentMethodInput, api) =>
    api.POST("/api/v1/payment-methods", { body: input }),
  revalidate: [PATHS.paymentMethods],
});

export const updatePaymentMethodAction = apiAction({
  call: ({ id, ...body }: UpdatePaymentMethodInput, api) =>
    api.PATCH("/api/v1/payment-methods/{id}", { params: { path: { id } }, body }),
  revalidate: [PATHS.paymentMethods],
});

export const createExpenseCategoryAction = apiAction({
  call: (input: CreateExpenseCategoryInput, api) =>
    api.POST("/api/v1/expense-categories", { body: input }),
  revalidate: [PATHS.expenseCategories],
});

export const updateExpenseCategoryAction = apiAction({
  call: ({ id, ...body }: UpdateExpenseCategoryInput, api) =>
    api.PATCH("/api/v1/expense-categories/{id}", { params: { path: { id } }, body }),
  revalidate: [PATHS.expenseCategories],
});
