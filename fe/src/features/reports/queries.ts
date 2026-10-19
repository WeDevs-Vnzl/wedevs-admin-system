import "server-only";
import { KPI_ID_VALUES, type ReportFilter } from "@/lib/validators/reports";
import * as reports from "@/mocks/services/reports";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/context";
import type { ReportPage } from "./report-catalog";

// Reads for the report pages (RSC). Owner/Admin only: `null` without `read report`, so the page answers the
// in-shell not-found (C13).

/** `/reports`: every KPI card over the range. */
export async function getKpiCards(filter: ReportFilter) {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "report")) return null;
  return Promise.all(KPI_ID_VALUES.map((id) => reports.getKpi(ctx, { id, filter })));
}

/** `/reports/[report]`: the report or KPI the slug names, over the range. */
export async function getReportPageData(page: ReportPage, filter: ReportFilter) {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "report")) return null;
  return page.kind === "report"
    ? reports.getReport(ctx, { id: page.id, filter })
    : reports.getKpi(ctx, { id: page.id, filter });
}
