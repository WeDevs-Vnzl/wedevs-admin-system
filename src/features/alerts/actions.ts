"use server";

import {
  dismissAlertInputSchema,
  listAlertsInputSchema,
  markAlertsReadInputSchema,
  restoreAlertInputSchema,
  snoozeAlertInputSchema,
} from "@/lib/validators/alerts";
import * as alerts from "@/mocks/services/alerts";
import { defineAction } from "@/server/actions/define-action";

// DT-71 / DT-79: dismissals and snoozes are the caller's own per-user state (like preferences), and the
// list is a role-filtered read computed from `ctx.user`, so every role may call them. The bell counter
// lives in the layout, hence the layout revalidation after a change.
const REFRESH_SHELL = [{ path: "/", type: "layout" as const }];

export const listAlertsAction = defineAction({
  permission: "authenticated",
  input: listAlertsInputSchema,
  handler: (ctx, data) => alerts.listAlerts(ctx, data),
});

export const dismissAlertAction = defineAction({
  permission: "authenticated",
  input: dismissAlertInputSchema,
  revalidate: REFRESH_SHELL,
  handler: (ctx, data) => alerts.dismissAlert(ctx, data),
});

export const snoozeAlertAction = defineAction({
  permission: "authenticated",
  input: snoozeAlertInputSchema,
  revalidate: REFRESH_SHELL,
  handler: (ctx, data) => alerts.snoozeAlert(ctx, data),
});

export const restoreAlertAction = defineAction({
  permission: "authenticated",
  input: restoreAlertInputSchema,
  revalidate: REFRESH_SHELL,
  handler: (ctx, data) => alerts.restoreAlert(ctx, data),
});

// "Marcar leídas" (A2): a per-user read mark; the alerts stay listed and only the bell counter drops.
export const markAlertsReadAction = defineAction({
  permission: "authenticated",
  input: markAlertsReadInputSchema,
  revalidate: REFRESH_SHELL,
  handler: (ctx, data) => alerts.markAlertsRead(ctx, data),
});
