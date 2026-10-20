"use server";

import { z } from "@/lib/validators/zod";
import {
  KPI_ID_VALUES,
  getKpiInputSchema,
  getReportInputSchema,
  reportFilterSchema,
} from "@/lib/validators/reports";
import * as reports from "@/mocks/services/reports";
import { defineAction } from "@/server/actions/define-action";

// Reads behind the `/reports` range filter (HU-31 CA2): a new range reloads every KPI card, or the open report or
// KPI. Owner/Admin only (`read report`, PRD §11).

const READ_REPORT = { action: "read", resource: "report" } as const;

export const getKpisAction = defineAction({
  permission: READ_REPORT,
  input: z.object({ filter: reportFilterSchema }),
  handler: (ctx, { filter }) =>
    Promise.all(KPI_ID_VALUES.map((id) => reports.getKpi(ctx, { id, filter }))),
});

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
