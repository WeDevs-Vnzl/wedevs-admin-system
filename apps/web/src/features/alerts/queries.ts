import "server-only";
import { getServerApi } from "@/lib/api/server";
import type { AlertsInboxDTO } from "@/lib/validators/alerts";
import { UnauthenticatedError } from "@/server/auth/session";
import type { ListAlertsFilter } from "./actions";

/** The current user's active alerts, most urgent first, filtered by role by the BE (PRD §7.9). */
export async function listAlerts(input: ListAlertsFilter = {}): Promise<AlertsInboxDTO> {
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/alerts", {
    params: { query: { types: input.types ? [...input.types] : undefined, limit: input.limit } },
  });
  if (response.status === 401) throw new UnauthenticatedError();
  if (!data) throw new Error(`GET /api/v1/alerts failed with ${response.status}`);
  return data;
}

/** The bell counter: the current user's active alerts not marked read (A2). */
export async function countUnreadAlerts(): Promise<number> {
  return (await listAlerts({ limit: 1 })).unread;
}
