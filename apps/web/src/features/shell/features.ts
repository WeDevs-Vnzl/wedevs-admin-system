import "server-only";
import { cache } from "react";
import { getServerApi } from "@/lib/api/server";
import { FEATURES_OFF, type Features } from "@/lib/features";

/**
 * The integration feature flags of the current request (`GET /api/v1/features`, DT-227), memoized per request.
 * Fails closed: any error or a missing body reads as every integration off.
 */
export const getFeatures = cache(async (): Promise<Features> => {
  try {
    const api = await getServerApi();
    const { data } = await api.GET("/api/v1/features");
    if (!data) return FEATURES_OFF;
    return {
      stripe: data.stripe === true,
      binance: data.binance === true,
      bankSync: data.bankSync === true,
    };
  } catch {
    return FEATURES_OFF;
  }
});
