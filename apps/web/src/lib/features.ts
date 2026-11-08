import type { FeaturesResponseDto } from "@/lib/api/types/features";

/**
 * The integration feature flags the BE answers on `GET /api/v1/features` (DT-227). The BE enforces them; the FE
 * only hides what the BE refuses.
 */
export type Features = Readonly<FeaturesResponseDto>;

/** What the FE assumes when the flags cannot be read: every integration off (fail closed). */
export const FEATURES_OFF: Features = { stripe: false, binance: false, bankSync: false };
