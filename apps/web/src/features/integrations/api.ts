import type { ApiClient } from "@/lib/api/client";
import { fromThrown, toActionResult, type ApiActionResult } from "@/lib/api/errors";
import type {
  IntegrationMappingDto,
  UpdateIntegrationMappingDto,
} from "@/lib/api/types/integrations";

/**
 * Calls of the integration mapping endpoints (DT-183, DT-184). The client is injected: the page reads with
 * the server client, the form saves with the browser client. The BE decides who may read or change it.
 */

async function guarded<T>(call: () => Promise<ApiActionResult<T>>): Promise<ApiActionResult<T>> {
  try {
    return await call();
  } catch (error) {
    return fromThrown(error);
  }
}

export function getIntegrationMapping(
  api: ApiClient,
): Promise<ApiActionResult<IntegrationMappingDto>> {
  return guarded(async () => toActionResult(await api.GET("/api/v1/settings/integrations")));
}

export function updateIntegrationMapping(
  api: ApiClient,
  input: UpdateIntegrationMappingDto,
): Promise<ApiActionResult<IntegrationMappingDto>> {
  return guarded(async () =>
    toActionResult(await api.PUT("/api/v1/settings/integrations", { body: input })),
  );
}
