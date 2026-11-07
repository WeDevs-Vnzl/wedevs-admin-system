import "server-only";
import { unwrapOrBoundary } from "@/features/settings/query-boundary";
import { toActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { BillingPageDTO } from "./types";

// Reads for the billing screen of a project (`/projects/[id]/billing`, PRD §8.4). Billing is finance data and the
// BE decides the grant (Owner and Admin): `FORBIDDEN` and `NOT_FOUND` are the in-shell not-found page (the
// "no permission" state), a signed-out caller goes to sign-in, anything else reaches the error boundary.

/** `GET /api/v1/projects/{id}/billing`: the plan with its installments, and the recurring charges. */
export async function getBillingPage(projectId: string): Promise<BillingPageDTO> {
  const api = await getServerApi();
  const { data, error, response } = await api.GET("/api/v1/projects/{id}/billing", {
    params: { path: { id: projectId } },
  });
  return unwrapOrBoundary(toActionResult({ data, error, response }));
}
