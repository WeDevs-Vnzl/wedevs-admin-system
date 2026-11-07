"use server";

import { apiAction } from "@/lib/api/action";
import type { KpiResultDto } from "@/lib/api/types/intel";
import type { ActionResult } from "@/lib/validators/common";
import type { KpiId, ReportFilter, ReportId } from "@/lib/validators/reports";
import { reportSlug } from "./report-catalog";
import { toReportQuery } from "./report-query";

// Reads behind the `/reports` range filter (HU-31 CA2): a new range reloads the open page through the BE. Owner
// and Admin only: the BE answers `FORBIDDEN` for the others (`report`, PRD §11).

/** Reloads the eighteen KPIs of a range: the BE response, the same shape the page reads. */
export const getKpisAction = apiAction({
  call: ({ filter }: { filter: ReportFilter }, api) =>
    api.GET("/api/v1/reports/kpis", { params: { query: toReportQuery(filter) } }),
});

/** Reloads one financial report of a range, by its slug. */
export const getReportAction = apiAction({
  call: ({ id, filter }: { id: ReportId; filter: ReportFilter }, api) =>
    api.GET("/api/v1/reports/{slug}", {
      params: { path: { slug: reportSlug(id) }, query: toReportQuery(filter) },
    }),
});

/** Reloads one KPI of a range: the BE computes the eighteen in one call, the detail picks its own. */
export async function getKpiAction({
  id,
  filter,
}: {
  id: KpiId;
  filter: ReportFilter;
}): Promise<ActionResult<KpiResultDto>> {
  const result = await getKpisAction({ filter });
  if (!result.ok) return result;
  const kpi = result.data.kpis.find((item) => item.id === id);
  return kpi
    ? { ok: true, data: kpi }
    : { ok: false, error: { code: "NOT_FOUND", message: "common.errors.NOT_FOUND" } };
}
