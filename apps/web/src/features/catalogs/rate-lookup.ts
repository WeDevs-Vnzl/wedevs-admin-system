import type { RateLookup } from "@/components/ui/rate-input";
import { lookupRateAction } from "./actions";

/**
 * Client adapter for `RateInput`'s `lookupRate` prop (DT-67): `(date, currency)` over `lookupRateAction`.
 * `null` (no rate on or before the date, or a refused/invalid lookup) tells the input the user types the rate.
 * FROZEN: name, parameters and result type (every finance form depends on it).
 */
export const lookupRate: RateLookup = async (date, currency) => {
  const result = await lookupRateAction({ date, currency });
  return result.ok ? result.data : null;
};
