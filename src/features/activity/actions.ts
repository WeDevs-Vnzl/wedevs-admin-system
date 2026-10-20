"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { activityFilterSchema } from "@/lib/validators/activity";
import * as activity from "@/mocks/services/activity";
import { exportCsv } from "@/mocks/services/export";
import { defineAction } from "@/server/actions/define-action";
import { ACTIVITY_EXPORT_COLUMNS } from "./columns";

// The activity log is read-only (C20): the only actions are reads and the export of the same rows.
// Owner and Admin read it (PRD §4.3, DT-66); Member and Viewer get no access.
const READ_ACTIVITY = { action: "read", resource: "activity" } as const;

/** "Cargar más" of the timeline: one page of the same filter, newest first. */
export const listActivityAction = defineAction({
  permission: READ_ACTIVITY,
  input: activityFilterSchema,
  handler: (ctx, data) => activity.listActivity(ctx, data),
});

/** "Exportar CSV" of `/activity` and of an entity's timeline: the filtered set, capped at 10,000 rows. */
export const exportActivityCsvAction = defineCsvExportAction({
  entity: "ACTIVITY",
  permission: READ_ACTIVITY,
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
    list: activity.listActivity,
    columns: ACTIVITY_EXPORT_COLUMNS,
  },
  exportCsv,
  namespace: "activity",
});
