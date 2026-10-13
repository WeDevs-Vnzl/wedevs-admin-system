import "server-only";
import {
  listAlertsInputSchema,
  type ListAlertsInput,
} from "@/lib/validators/alerts";
import * as alerts from "@/mocks/services/alerts";
import { getServiceContext } from "@/server/context";

/** The current user's active alerts, filtered by role inside the service (PRD §7.9). */
export async function listAlerts(input: Partial<ListAlertsInput> = {}) {
  return alerts.listAlerts(await getServiceContext(), listAlertsInputSchema.parse(input));
}
