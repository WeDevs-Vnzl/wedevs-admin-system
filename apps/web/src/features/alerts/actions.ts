"use server";

import { apiAction } from "@/lib/api/action";
import type {
  AlertDismissalDTO,
  AlertsInboxDTO,
  AlertsReadResultDTO,
  DismissAlertInput,
  ListAlertsInput,
  MarkAlertsReadInput,
  RestoreAlertInput,
  SnoozeAlertInput,
} from "@/lib/validators/alerts";

// DT-71 / DT-79: dismissals and snoozes are the caller's own per-user state (like preferences), and the
// list is a role-filtered read computed by the BE from the caller, so every role may call them. The bell
// counter lives in the layout, hence the layout revalidation after a change. The BE decides everything:
// these are thin proxies (C10), with no `can()` and no business rule here.
const REFRESH_SHELL = [{ path: "/", type: "layout" as const }];

/** The row filters the alert list sends; both are optional and the BE applies its defaults. */
export type ListAlertsFilter = Partial<Pick<ListAlertsInput, "types" | "limit">>;

export const listAlertsAction = apiAction<ListAlertsFilter, AlertsInboxDTO>({
  call: (input, api) =>
    api.GET("/api/v1/alerts", {
      params: { query: { types: input.types ? [...input.types] : undefined, limit: input.limit } },
    }),
});

// Dismiss for good (no body) or snooze (`{ days }`, 1–90): both are the same BE endpoint, so the two
// actions below differ only in the body they send.
export const dismissAlertAction = apiAction<Pick<DismissAlertInput, "alertKey">, AlertDismissalDTO>({
  call: (input, api) =>
    api.POST("/api/v1/alerts/{key}/dismiss", { params: { path: { key: input.alertKey } } }),
  revalidate: REFRESH_SHELL,
});

export const snoozeAlertAction = apiAction<SnoozeAlertInput, AlertDismissalDTO>({
  call: (input, api) =>
    api.POST("/api/v1/alerts/{key}/dismiss", {
      params: { path: { key: input.alertKey } },
      body: { days: input.days },
    }),
  revalidate: REFRESH_SHELL,
});

export const restoreAlertAction = apiAction<RestoreAlertInput, AlertDismissalDTO>({
  call: (input, api) =>
    api.POST("/api/v1/alerts/{key}/restore", { params: { path: { key: input.alertKey } } }),
  revalidate: REFRESH_SHELL,
});

// "Marcar leídas" (A2): a per-user read mark; the alerts stay listed and only the bell counter drops.
export const markAlertsReadAction = apiAction<MarkAlertsReadInput, AlertsReadResultDTO>({
  call: (input, api) => api.POST("/api/v1/alerts/read", { body: { alertKeys: input.alertKeys } }),
  revalidate: REFRESH_SHELL,
});
