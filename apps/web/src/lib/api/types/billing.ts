import type { components } from "../schema";

// Generated billing DTOs re-exported for the billing module: code outside `src/lib/api/**` may not import the
// schema (ESLint, C8).

/** One billing page: the plan, its installments and the recurring charges (`GET /api/v1/projects/{id}/billing`; also the answer of every billing write). */
export type BillingPageResponseDto = components["schemas"]["BillingPageResponseDto"];
/** `PUT /api/v1/projects/{id}/billing-plan`. */
export type UpsertBillingPlanDto = components["schemas"]["UpsertBillingPlanDto"];
/** `POST /api/v1/projects/{id}/billing-plan/template`. */
export type ApplyInstallmentTemplateDto = components["schemas"]["ApplyInstallmentTemplateDto"];
/** `POST /api/v1/projects/{id}/installments`. */
export type CreateInstallmentDto = components["schemas"]["CreateInstallmentDto"];
/** `PATCH /api/v1/installments/{id}`. */
export type UpdateInstallmentDto = components["schemas"]["UpdateInstallmentDto"];
/** `POST /api/v1/projects/{id}/recurring-charges`. */
export type CreateRecurringChargeDto = components["schemas"]["CreateRecurringChargeDto"];
/** `PATCH /api/v1/recurring-charges/{id}`. */
export type UpdateRecurringChargeDto = components["schemas"]["UpdateRecurringChargeDto"];
/** `POST /api/v1/recurring-charges/{id}/status`. */
export type SetRecurringChargeStatusDto = components["schemas"]["SetRecurringChargeStatusDto"];
/** `POST /api/v1/recurring-charges/{id}/generate-missing-periods`. */
export type GenerateMissingPeriodsDto = components["schemas"]["GenerateMissingPeriodsDto"];
/** The periods the BE created, as it returned them. */
export type GenerateMissingPeriodsResponseDto =
  components["schemas"]["GenerateMissingPeriodsResponseDto"];
