import type { BillingPlanDTO, InstallmentDTO, RecurringChargeDTO } from "@/lib/validators/billing";

// Shapes the billing screen reads. They mirror what the billing service returns (MOCK until Hito 2); the components
// never import the store or the services (lint boundary C9).

/** The plan with its D1 snapshot of the contract in USD (C16). */
export type BillingPlanRow = BillingPlanDTO;

export type BillingPageDTO = {
  projectId: string;
  plan: BillingPlanRow | null;
  installments: InstallmentDTO[];
  recurringCharges: RecurringChargeDTO[];
};
