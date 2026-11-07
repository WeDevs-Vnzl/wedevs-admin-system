"use server";

import { apiAction } from "@/lib/api/action";
import {
  getKpiInputSchema,
  getReportInputSchema,
  type ReportFilter,
} from "@/lib/validators/reports";
import * as reports from "@/mocks/services/reports";
import { defineAction } from "@/server/actions/define-action";
import { toReportQuery } from "./report-query";

// Reads behind the `/reports` range filter (HU-31 CA2): a new range reloads every KPI card through the BE. Owner
// and Admin only: the BE answers `FORBIDDEN` for the others (`report`, PRD §11).

/** Reloads the eighteen KPIs of a range: the BE response, the same shape the page reads. */
export const getKpisAction = apiAction({
  call: ({ filter }: { filter: ReportFilter }, api) =>
    api.GET("/api/v1/reports/kpis", { params: { query: toReportQuery(filter) } }),
});

// MOCK — until cleanup: the report detail still reads the mock service (see `getReportPageData`).
const READ_REPORT = { action: "read", resource: "report" } as const;

export const getReportAction = defineAction({
  permission: READ_REPORT,
  input: getReportInputSchema,
  handler: (ctx, data) => reports.getReport(ctx, data),
});

export const getKpiAction = defineAction({
  permission: READ_REPORT,
  input: getKpiInputSchema,
  handler: (ctx, data) => reports.getKpi(ctx, data),
});
