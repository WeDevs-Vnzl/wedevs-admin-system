import "server-only";
import { fromThrown, toActionResult, type ApiActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { KpisResponseDto } from "@/lib/api/types/intel";
import type { ReportFilter } from "@/lib/validators/reports";
import * as reports from "@/mocks/services/reports";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/context";
import type { ReportPage } from "./report-catalog";
import { toReportQuery } from "./report-query";

// Reads for the report pages (RSC). The KPI cards come from the BE in one call (`GET /reports/kpis`); a Member or
// Viewer gets the `FORBIDDEN` error, which the page turns into the forbidden state (the BE decides, C13).

/** `/reports`: the eighteen KPIs over the range, as the BE computes them (C16, C17). */
export async function getKpiCards(filter: ReportFilter): Promise<ApiActionResult<KpisResponseDto>> {
  try {
    const api = await getServerApi();
    return toActionResult(
      await api.GET("/api/v1/reports/kpis", { params: { query: toReportQuery(filter) } }),
    );
  } catch (error) {
    return fromThrown(error);
  }
}

// MOCK — until cleanup: the report detail (`/reports/[report]`) still reads the mock service; it moves to the BE
// with the report sections once the generated `reportId` discriminator is fixed (see the INTEL report).
/** `/reports/[report]`: the report or KPI the slug names, over the range. */
export async function getReportPageData(page: ReportPage, filter: ReportFilter) {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "report")) return null;
  return page.kind === "report"
    ? reports.getReport(ctx, { id: page.id, filter })
    : reports.getKpi(ctx, { id: page.id, filter });
}
