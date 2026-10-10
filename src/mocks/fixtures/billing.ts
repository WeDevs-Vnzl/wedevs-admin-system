// MOCK — billing fixtures of Hito 1 (data-rules.md §2). Typed empty stubs: the module package that builds
// the billing UI fills them (plans, installments, recurring charges) and owns this file from then on.
import type { BillingPlanDTO, InstallmentDTO, RecurringChargeDTO } from "@/lib/validators/billing";

export const billingPlanFixtures: BillingPlanDTO[] = [];
export const installmentFixtures: InstallmentDTO[] = [];
export const recurringChargeFixtures: RecurringChargeDTO[] = [];
