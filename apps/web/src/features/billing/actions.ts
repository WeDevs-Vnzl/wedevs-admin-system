"use server";

import {
  applyInstallmentTemplateInputSchema,
  cancelInstallmentInputSchema,
  createInstallmentInputSchema,
  createRecurringChargeInputSchema,
  generateMissingPeriodsInputSchema,
  setRecurringChargeStatusInputSchema,
  updateInstallmentInputSchema,
  updateRecurringChargeInputSchema,
  upsertBillingPlanInputSchema,
} from "@/lib/validators/billing";
import * as billing from "@/mocks/services/billing";
import { defineAction, type RevalidateTarget } from "@/server/actions/define-action";

// A billing change shows on the project (its billing tab and summary) and on the alerts of the shell and the
// dashboard ("Cuota por facturar", HU-10 CA4), so both layouts are refreshed.
const BILLING_PATHS: readonly RevalidateTarget[] = [
  { path: "/projects", type: "layout" },
  { path: "/", type: "layout" },
];

export const upsertBillingPlanAction = defineAction({
  permission: { action: "update", resource: "billing" },
  input: upsertBillingPlanInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.upsertBillingPlan(ctx, data),
});

export const applyInstallmentTemplateAction = defineAction({
  permission: { action: "create", resource: "billing" },
  input: applyInstallmentTemplateInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.applyInstallmentTemplate(ctx, data),
});

export const createInstallmentAction = defineAction({
  permission: { action: "create", resource: "billing" },
  input: createInstallmentInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.createInstallment(ctx, data),
});

export const updateInstallmentAction = defineAction({
  permission: { action: "update", resource: "billing" },
  input: updateInstallmentInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.updateInstallment(ctx, data),
});

export const cancelInstallmentAction = defineAction({
  permission: { action: "update", resource: "billing" },
  input: cancelInstallmentInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.cancelInstallment(ctx, data),
});

export const createRecurringChargeAction = defineAction({
  permission: { action: "create", resource: "billing" },
  input: createRecurringChargeInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.createRecurringCharge(ctx, data),
});

export const updateRecurringChargeAction = defineAction({
  permission: { action: "update", resource: "billing" },
  input: updateRecurringChargeInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.updateRecurringCharge(ctx, data),
});

export const setRecurringChargeStatusAction = defineAction({
  permission: { action: "update", resource: "billing" },
  input: setRecurringChargeStatusInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.setRecurringChargeStatus(ctx, data),
});

export const generateMissingPeriodsAction = defineAction({
  permission: { action: "create", resource: "billing" },
  input: generateMissingPeriodsInputSchema,
  revalidate: BILLING_PATHS,
  handler: (ctx, data) => billing.generateMissingPeriods(ctx, data),
});
