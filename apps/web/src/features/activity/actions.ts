"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { apiAction } from "@/lib/api/action";
import type { ActivityListResponseDto } from "@/lib/api/types/activity";
import {
  activityFilterSchema,
  type ActivityFilter,
  type ActivityFilterInput,
} from "@/lib/validators/activity";
import { errorMessageKey, zodFieldErrors, type ActionResult } from "@/lib/validators/common";
import { requestActivityPage } from "./api";
import { ACTIVITY_EXPORT_COLUMNS } from "./columns";
import { activityListQuery } from "./query-params";

// The activity log is read-only (C20): the only actions are reads and the export of the same rows.
// Owner and Admin read it (PRD §4.3, DT-66); the BE decides (`can()`), Member and Viewer get FORBIDDEN.

const listActivity = apiAction<ActivityFilter, ActivityListResponseDto>({
  call: (data, api) => requestActivityPage(api, activityListQuery(data)),
});

/** "Cargar más" of the timeline: one page of the same filter, newest first. */
export async function listActivityAction(
  raw: ActivityFilterInput,
): Promise<ActionResult<ActivityListResponseDto>> {
  const parsed = activityFilterSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: errorMessageKey("VALIDATION"),
        fieldErrors: zodFieldErrors(parsed.error),
      },
    };
  }
  return listActivity(parsed.data);
}

/** "Exportar CSV" of `/activity` and of an entity's timeline: the filtered set, capped at 10,000 rows. */
export const exportActivityCsvAction = defineCsvExportAction({
  entity: "ACTIVITY",
  source: {
    entity: "ACTIVITY",
    facets: [
      { id: "actorId", kind: "options" },
      { id: "actorType", kind: "options" },
      { id: "action", kind: "options" },
      { id: "entityType", kind: "options" },
      { id: "date", kind: "dateRange", fromKey: "from", toKey: "to" },
    ],
    filterSchema: activityFilterSchema,
    columns: ACTIVITY_EXPORT_COLUMNS,
  },
  namespace: "activity",
});
