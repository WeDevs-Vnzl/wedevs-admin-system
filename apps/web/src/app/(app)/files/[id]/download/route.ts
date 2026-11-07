import { notFound, redirect } from "next/navigation";
import { SIGN_IN_PATH } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";

/**
 * Authenticated download (DT-206, Q-FEINT-4): the browser cannot send the Bearer token to the BE, so links
 * point here. The server API client asks the BE and relays its `302` (a 60-second signed URL). No logic and
 * no caching; the BE's 404/403 render the in-shell not-found (a missing and a forbidden file look alike).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const api = await getServerApi();
  const { response } = await api.GET("/api/v1/files/{id}/download", {
    params: { path: { id } },
    redirect: "manual",
  });

  const location = response.headers.get("location");
  if (response.status === 302 && location) {
    return new Response(null, {
      status: 302,
      headers: { location, "cache-control": "no-store" },
    });
  }
  if (response.status === 401) redirect(SIGN_IN_PATH);
  if (response.status === 404 || response.status === 403) notFound();
  return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
}
