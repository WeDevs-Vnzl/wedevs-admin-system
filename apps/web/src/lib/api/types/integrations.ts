import type { components } from "../schema";

// Generated DTOs of the integration mapping endpoints, re-exported for code outside `src/lib/api/**` (C8).

/** `GET|PUT /api/v1/settings/integrations`: where Stripe and Binance money lands (DT-183, DT-184). */
export type IntegrationMappingDto = components["schemas"]["IntegrationMappingResponseDto"];
/** Body of `PUT /api/v1/settings/integrations`: a provider key set to `null` clears its mapping. */
export type UpdateIntegrationMappingDto = components["schemas"]["UpdateIntegrationMappingDto"];
