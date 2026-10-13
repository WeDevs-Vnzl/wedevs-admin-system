"use server";

import { getRateForInputSchema } from "@/lib/validators/catalogs";
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
