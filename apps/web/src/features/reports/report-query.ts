import type { ReportFilter } from "@/lib/validators/reports";

// Query of the BE report endpoints (`GET /api/v1/reports/kpis` and `/reports/{slug}`) for the global filters of
// `/reports` (PRD §8.13). The preset alone resolves the range in the BE; `from`/`to` go only with a custom range.
// Pure, so the queries and the actions share it.

export type ReportQuery = {
  preset: ReportFilter["preset"];
  from?: string;
  to?: string;
  clientId?: string;
  projectId?: string;
  tagId?: string;
};

export function toReportQuery(filter: ReportFilter): ReportQuery {
  const query: ReportQuery = { preset: filter.preset };
  if (filter.preset === "CUSTOM") {
    if (filter.dateFrom !== undefined) query.from = filter.dateFrom;
    if (filter.dateTo !== undefined) query.to = filter.dateTo;
  }
  if (filter.clientId !== undefined) query.clientId = filter.clientId;
  if (filter.projectId !== undefined) query.projectId = filter.projectId;
  if (filter.tagId !== undefined) query.tagId = filter.tagId;
  return query;
}
