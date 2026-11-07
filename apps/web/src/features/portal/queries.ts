import "server-only";
import { createPortalApiClient, type ApiClient } from "@/lib/api/client";
import type { PortalShareDto } from "@/lib/api/types/portal";
import { fetchPortalPage } from "./api";

// Server read of the public portal (PRD §8.11, C22, DT-212). It never reads the session; the BE decides the status.

export type PortalPageResult =
  { kind: "ok"; page: PortalShareDto } | { kind: "not-found" } | { kind: "rate-limited" };

/**
 * Probes `GET /portal/{token}` (no side effect, no log row). A 404 is the generic "not available" for an unknown,
 * revoked, expired or void link alike (it never says why); `RATE_LIMITED` is the "try again" state (the probes of
 * every visitor share the FE server's bucket, DT-212); any other failure reaches the error boundary.
 */
export async function loadPortalPage(
  token: string,
  api: ApiClient = createPortalApiClient(),
): Promise<PortalPageResult> {
  const result = await fetchPortalPage(api, token);
  if (result.ok) return { kind: "ok", page: result.data };
  if (result.error.code === "NOT_FOUND") return { kind: "not-found" };
  if (result.error.code === "RATE_LIMITED") return { kind: "rate-limited" };
  throw new Error(`Portal probe failed: ${result.error.code}`);
}
