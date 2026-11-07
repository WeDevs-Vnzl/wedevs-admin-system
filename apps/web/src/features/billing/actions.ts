"use server";

import { apiAction, type RevalidateTarget } from "@/lib/api/action";
import type {
  BillingPageResponseDto,
  GenerateMissingPeriodsResponseDto,
} from "@/lib/api/types/billing";
import type {
  ApplyInstallmentTemplateInput,
  CancelInstallmentInput,
  CreateRecurringChargeInput,
  GenerateMissingPeriodsInput,
  SetRecurringChargeStatusInput,
  UpdateRecurringChargeInput,
  createInstallmentInputSchema,
  updateInstallmentInputSchema,
  upsertBillingPlanInputSchema,
} from "@/lib/validators/billing";
import type { z } from "@/lib/validators/zod";

// The form-side shapes: optional fields may be absent (the BE re-validates and applies its defaults).
type UpsertBillingPlanInput = z.input<typeof upsertBillingPlanInputSchema>;
type CreateInstallmentInput = z.input<typeof createInstallmentInputSchema>;
type UpdateInstallmentInput = z.input<typeof updateInstallmentInputSchema>;

// Thin API proxies (C10): token → one BE call → error mapping → revalidate. The BE decides the grant and every
// rule (billed installments are locked, the rate of the day is required); the FE never checks `can()` here.
//
// A billing change shows on the project (its billing tab and summary) and on the alerts of the shell and the
// dashboard ("Cuota por facturar", HU-10 CA4), so both layouts are refreshed.
const BILLING_PATHS: readonly RevalidateTarget[] = [
  { path: "/projects", type: "layout" },
  { path: "/", type: "layout" },
];

/** Saves the plan; the BE takes the USD snapshot (C16). A missing rate is `billing.errors.rateMissing` on `currency`. */
export const upsertBillingPlanAction = apiAction<UpsertBillingPlanInput, BillingPageResponseDto>({
  call: ({ projectId, ...body }, api) =>
    api.PUT("/api/v1/projects/{id}/billing-plan", { params: { path: { id: projectId } }, body }),
  revalidate: BILLING_PATHS,
});

/** Replaces (or appends to) the pending installments with a quick template; the BE computes the amounts. */
export const applyInstallmentTemplateAction = apiAction<
  ApplyInstallmentTemplateInput,
  BillingPageResponseDto
>({
  call: ({ projectId, ...body }, api) =>
    api.POST("/api/v1/projects/{id}/billing-plan/template", {
      params: { path: { id: projectId } },
      body,
    }),
  revalidate: BILLING_PATHS,
});

export const createInstallmentAction = apiAction<CreateInstallmentInput, BillingPageResponseDto>({
  call: ({ projectId, ...body }, api) =>
    api.POST("/api/v1/projects/{id}/installments", { params: { path: { id: projectId } }, body }),
  revalidate: BILLING_PATHS,
});

export const updateInstallmentAction = apiAction<UpdateInstallmentInput, BillingPageResponseDto>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/installments/{id}", { params: { path: { id } }, body }),
  revalidate: BILLING_PATHS,
});

export const cancelInstallmentAction = apiAction<CancelInstallmentInput, BillingPageResponseDto>({
  call: ({ id }, api) => api.POST("/api/v1/installments/{id}/cancel", { params: { path: { id } } }),
  revalidate: BILLING_PATHS,
});

export const createRecurringChargeAction = apiAction<
  CreateRecurringChargeInput,
  BillingPageResponseDto
>({
  call: ({ projectId, ...body }, api) =>
    api.POST("/api/v1/projects/{id}/recurring-charges", {
      params: { path: { id: projectId } },
      body,
    }),
  revalidate: BILLING_PATHS,
});

export const updateRecurringChargeAction = apiAction<
  UpdateRecurringChargeInput,
  BillingPageResponseDto
>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/recurring-charges/{id}", { params: { path: { id } }, body }),
  revalidate: BILLING_PATHS,
});

/** Pauses, resumes or finishes a charge; a resume never back-fills (the periods are generated on request). */
export const setRecurringChargeStatusAction = apiAction<
  SetRecurringChargeStatusInput,
  BillingPageResponseDto
>({
  call: ({ id, status }, api) =>
    api.POST("/api/v1/recurring-charges/{id}/status", {
      params: { path: { id } },
      body: { status },
    }),
  revalidate: BILLING_PATHS,
});

/** Creates the periods skipped while the charge was paused; resolves to the periods the BE created. */
export const generateMissingPeriodsAction = apiAction<
  GenerateMissingPeriodsInput,
  GenerateMissingPeriodsResponseDto
>({
  call: ({ recurringChargeId, ...body }, api) =>
    api.POST("/api/v1/recurring-charges/{id}/generate-missing-periods", {
      params: { path: { id: recurringChargeId } },
      body,
    }),
  revalidate: BILLING_PATHS,
});
