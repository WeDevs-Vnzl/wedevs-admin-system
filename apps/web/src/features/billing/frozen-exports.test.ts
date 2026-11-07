import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/features/projects/queries", () => ({ getProjectFinancials: vi.fn() }));

import { installmentSumMismatch, splitByTemplate } from "@/lib/finance/installments";
import {
  INSTALLMENT_TEMPLATE_PERCENTAGES,
  type BillingPlanDTO,
  type InstallmentDTO,
  type InstallmentTemplate,
  type ProjectFinancialSummary,
  type RecurringChargeDTO,
} from "@/lib/validators/billing";
import { ProjectBillingTab } from "./components/project-billing-tab";
import type { BillingPageDTO } from "./types";

// The W2 frozen exports of package 3.2 (DT-218): consumers (2.9, 3.4, the mocks, `lib/finance`) code against
// these signatures.
describe("billing frozen exports", () => {
  it("keeps ProjectBillingTab({ projectId }: { projectId: string })", () => {
    expectTypeOf(ProjectBillingTab).parameters.toEqualTypeOf<[{ projectId: string }]>();
  });

  it("keeps the installment types and the preview inputs lib/finance reads", () => {
    expectTypeOf<InstallmentDTO["amount"]>().toBeString();
    expectTypeOf<InstallmentDTO["locked"]>().toBeBoolean();
    expectTypeOf<BillingPlanDTO["installments"]>().toEqualTypeOf<InstallmentDTO[]>();
    expectTypeOf<RecurringChargeDTO["monthlyAmount"]>().toBeString();
    expectTypeOf<ProjectFinancialSummary["toInvoice"]>().toEqualTypeOf<string | null>();
    expectTypeOf<BillingPageDTO["installments"]>().toEqualTypeOf<InstallmentDTO[]>();
    expectTypeOf(INSTALLMENT_TEMPLATE_PERCENTAGES).toEqualTypeOf<
      Record<InstallmentTemplate, readonly string[]>
    >();
    expectTypeOf(splitByTemplate).parameters.toEqualTypeOf<[InstallmentTemplate, string]>();
    expect(splitByTemplate("SPLIT_40_30_30", "10000.00").map((row) => row.amount)).toEqual([
      "4000.00",
      "3000.00",
      "3000.00",
    ]);
    expect(
      installmentSumMismatch("10000.00", [{ amount: "9000.00", kind: "CUOTA", cancelled: false }]),
    ).toBe("-1000.00");
  });
});
