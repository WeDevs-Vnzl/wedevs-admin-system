import "server-only";
import { fromThrown, toActionResult, type ApiActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { KpiResultDto, KpisResponseDto, ReportResponseDto } from "@/lib/api/types/intel";
import type { KpiId, ReportFilter, ReportId } from "@/lib/validators/reports";
import { reportSlug } from "./report-catalog";
import { toReportQuery } from "./report-query";

// Reads for the report pages (RSC). The BE decides who reads them: a Member or Viewer gets the `FORBIDDEN` error,
// which the page turns into the forbidden state (C13). Figures, margins and KPIs are the BE's (C16, C17).

/** `/reports`: the eighteen KPIs over the range, in one call. */
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

/** `/reports/[report]` for a financial report: one of the ten, by its kebab-case slug. */
export async function getReportDetail(
  id: ReportId,
  filter: ReportFilter,
): Promise<ApiActionResult<ReportResponseDto>> {
  try {
    const api = await getServerApi();
    return toActionResult(
      await api.GET("/api/v1/reports/{slug}", {
        params: { path: { slug: reportSlug(id) }, query: toReportQuery(filter) },
      }),
    );
  } catch (error) {
    return fromThrown(error);
  }
}

/** `/reports/[report]` for a KPI: the KPI picked from the range's one BE call. */
export async function getKpiDetail(
  id: KpiId,
  filter: ReportFilter,
): Promise<ApiActionResult<KpiResultDto>> {
  const result = await getKpiCards(filter);
  if (!result.ok) return result;
  const kpi = result.data.kpis.find((item) => item.id === id);
  if (!kpi) return { ok: false, error: { code: "NOT_FOUND", message: "common.errors.NOT_FOUND" } };
  return { ok: true, data: kpi };
}
