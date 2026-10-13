import type { RateLookup } from "@/components/ui/rate-input";
import { lookupRateAction } from "./actions";

/**
 * Client adapter for `RateInput`'s `lookupRate` prop (DT-67): `(date, currency)` over `lookupRateAction`.
 * `null` (no rate on or before the date, or a refused/invalid lookup) tells the input the user types the rate.
 */
export const lookupRate: RateLookup = async (date, currency) => {
  const result = await lookupRateAction({ date, currency } as Parameters<typeof lookupRateAction>[0]);
  return result.ok ? result.data : null;
};
