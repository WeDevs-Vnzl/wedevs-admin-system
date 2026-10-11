// Column and export definitions of the activity log. Pure and client-safe: the list and the export action
// read the same column ids. IP and user agent are never exported (C5, PRD §8.14): only the timeline shows
// them, masked, in the detail sheet.
import type { ActivityFilter, ActivityListRowDTO } from "@/lib/validators/activity";
import type { ExportColumnSpec } from "@/lib/validators/export";
import type { ListFilters, ListQuery } from "@/lib/validators/common";

/** Every column the export can write. Header keys live in the `activity` namespace (`columns.<id>`). */
export const ACTIVITY_EXPORT_COLUMNS: Record<string, ExportColumnSpec<ActivityListRowDTO>> = {
  createdAt: { labelKey: "columns.createdAt", value: (row) => row.createdAt },
  actor: { labelKey: "columns.actor", value: (row) => row.actor.name ?? row.actor.type },
  action: { labelKey: "columns.action", value: (row) => row.action },
  entityType: { labelKey: "columns.entityType", value: (row) => row.entityType },
  entityLabel: { labelKey: "columns.entityLabel", value: (row) => row.entityLabel },
  entityId: { labelKey: "columns.entityId", value: (row) => row.entityId },
};

/**
 * The table query of an activity filter, as the CSV export receives it (the kit's `ListQuery` shape: facets
 * under `filters`, the date range as one `dateRange` facet `date`). Export always starts at page 1.
 */
export function activityExportQuery(filter: ActivityFilter): ListQuery {
  const filters: ListFilters = {};
  if (filter.actorId) filters.actorId = filter.actorId;
  if (filter.actorType) filters.actorType = filter.actorType;
  if (filter.action) filters.action = filter.action;
  if (filter.entityType) filters.entityType = filter.entityType;
  if (filter.from || filter.to) filters.date = [filter.from ?? "", filter.to ?? ""];
  return {
    page: 1,
    pageSize: filter.pageSize,
    sort: filter.sort,
    q: filter.q,
    includeArchived: false,
    filters,
  };
}
