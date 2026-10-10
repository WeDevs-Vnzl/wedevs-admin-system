import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/billing.json";
import es from "@/i18n/messages/es/billing.json";
import { sumMoney } from "../money";
import { VALIDATION_MESSAGES } from "./common";
import {
  BILLING_MESSAGES,
  INSTALLMENT_TEMPLATE_PERCENTAGES,
  INSTALLMENT_TEMPLATE_VALUES,
  applyInstallmentTemplateInputSchema,
  billingDaySchema,
  billingPlanDtoSchema,
  cancelInstallmentInputSchema,
  createInstallmentInputSchema,
  createRecurringChargeInputSchema,
  generateMissingPeriodsInputSchema,
  projectFinancialSummarySchema,
  setRecurringChargeStatusInputSchema,
  updateInstallmentInputSchema,
  updateRecurringChargeInputSchema,
  upsertBillingPlanInputSchema,
} from "./billing";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

function hasKey(catalog: unknown, path: string[]): boolean {
  let node: unknown = catalog;
  for (const part of path) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" && node.length > 0;
}

describe("billing message keys", () => {
  it("exist in the billing namespace for es and en", () => {
    for (const key of Object.values(BILLING_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("billing plan", () => {
  const plan = {
    projectId: "p1",
    model: "PRECIO_FIJO",
    currency: "USD",
    contractAmount: "5000.00",
  };

  it("accepts fixed, mixed and recurring plans", () => {
    expect(upsertBillingPlanInputSchema.safeParse(plan).success).toBe(true);
    expect(upsertBillingPlanInputSchema.safeParse({ ...plan, model: "MIXTO" }).success).toBe(true);
    const recurring = { projectId: "p1", model: "RECURRENTE", currency: "USD" };
    expect(upsertBillingPlanInputSchema.safeParse(recurring).success).toBe(true);
  });

  it("requires the contract amount unless the plan is recurring", () => {
    const { contractAmount, ...withoutAmount } = plan;
    void contractAmount;
    expect(messages(upsertBillingPlanInputSchema.safeParse(withoutAmount))).toContain(
      BILLING_MESSAGES.contractAmountRequired,
    );
  });

  it("money rejects numbers and more than 2 decimals", () => {
    expect(upsertBillingPlanInputSchema.safeParse({ ...plan, contractAmount: 5000 }).success).toBe(
      false,
    );
    expect(
      messages(upsertBillingPlanInputSchema.safeParse({ ...plan, contractAmount: "10.001" })),
    ).toContain(VALIDATION_MESSAGES.moneyTooManyDecimals);
    expect(upsertBillingPlanInputSchema.safeParse({ ...plan, contractAmount: "0" }).success).toBe(
      false,
    );
  });

  it("DTO flags an inconsistent schedule", () => {
    const dto = {
      id: "bp1",
      projectId: "p1",
      model: "PRECIO_FIJO",
      currency: "USD",
      contractAmount: "5000.00",
      notes: null,
      installments: [],
      installmentsTotal: "4500.00",
      scheduleDifference: "500.00",
      scheduleConsistent: false,
      createdAt: "2026-10-09T10:00:00Z",
      updatedAt: "2026-10-09T10:00:00Z",
    };
    expect(billingPlanDtoSchema.safeParse(dto).success).toBe(true);
  });
});

describe("installment templates", () => {
  it("lists the six templates of the PRD", () => {
    expect([...INSTALLMENT_TEMPLATE_VALUES]).toEqual([
      "FULL_UPFRONT",
      "SPLIT_50_50",
      "SPLIT_40_30_30",
      "SPLIT_30_40_30",
      "THREE_EQUAL",
      "CUSTOM",
    ]);
  });

  it("every fixed template adds up to 100 %; custom generates nothing", () => {
    for (const template of INSTALLMENT_TEMPLATE_VALUES) {
      const percentages = INSTALLMENT_TEMPLATE_PERCENTAGES[template];
      if (template === "CUSTOM") expect(percentages).toEqual([]);
      else expect(sumMoney([...percentages]), template).toBe("100.00");
    }
  });

  it("a fixed template takes no installments; custom requires them", () => {
    expect(
      applyInstallmentTemplateInputSchema.parse({ projectId: "p1", template: "SPLIT_50_50" })
        .replacePending,
    ).toBe(true);
    const supplied = {
      projectId: "p1",
      template: "SPLIT_50_50",
      installments: [{ kind: "CUOTA", label: "Cuota", amount: "100.00", currency: "USD" }],
    };
    expect(messages(applyInstallmentTemplateInputSchema.safeParse(supplied))).toContain(
      BILLING_MESSAGES.templateInstallmentsNotAllowed,
    );
    expect(
      messages(
        applyInstallmentTemplateInputSchema.safeParse({ projectId: "p1", template: "CUSTOM" }),
      ),
    ).toContain(BILLING_MESSAGES.customInstallmentsRequired);
    expect(
      applyInstallmentTemplateInputSchema.safeParse({ ...supplied, template: "CUSTOM" }).success,
    ).toBe(true);
  });

  it("rejects an unknown template", () => {
    expect(
      applyInstallmentTemplateInputSchema.safeParse({ projectId: "p1", template: "SPLIT_90_10" })
        .success,
    ).toBe(false);
  });
});

describe("installments", () => {
  const base = {
    projectId: "p1",
    kind: "ANTICIPO",
    label: "Anticipo 40 %",
    amount: "2000.00",
    currency: "USD",
  };

  it("accepts a valid installment", () => {
    expect(createInstallmentInputSchema.safeParse(base).success).toBe(true);
    expect(
      createInstallmentInputSchema.safeParse({ ...base, percentage: "40", dueDate: "2026-11-01" })
        .success,
    ).toBe(true);
  });

  it("rejects numbers, > 2 decimals, zero and negative amounts", () => {
    expect(createInstallmentInputSchema.safeParse({ ...base, amount: 2000 }).success).toBe(false);
    expect(
      messages(createInstallmentInputSchema.safeParse({ ...base, amount: "1.999" })),
    ).toContain(VALIDATION_MESSAGES.moneyTooManyDecimals);
    expect(messages(createInstallmentInputSchema.safeParse({ ...base, amount: "0.00" }))).toContain(
      VALIDATION_MESSAGES.moneyMustBePositive,
    );
    expect(
      messages(createInstallmentInputSchema.safeParse({ ...base, amount: "-5.00" })),
    ).toContain(VALIDATION_MESSAGES.moneyMustBePositive);
  });

  it("only an adjustment may be negative, and never zero", () => {
    expect(
      createInstallmentInputSchema.safeParse({ ...base, kind: "AJUSTE", amount: "-300.00" })
        .success,
    ).toBe(true);
    expect(
      messages(createInstallmentInputSchema.safeParse({ ...base, kind: "AJUSTE", amount: "0.00" })),
    ).toContain(BILLING_MESSAGES.adjustmentNonZero);
  });

  it("recurring installments cannot be created by hand", () => {
    expect(
      messages(createInstallmentInputSchema.safeParse({ ...base, kind: "RECURRENTE" })),
    ).toContain(BILLING_MESSAGES.installmentKindNotManual);
  });

  it("rejects an out-of-range percentage", () => {
    expect(createInstallmentInputSchema.safeParse({ ...base, percentage: "101" }).success).toBe(
      false,
    );
  });

  it("update needs at least one change; cancel takes an id", () => {
    expect(messages(updateInstallmentInputSchema.safeParse({ id: "i1" }))).toContain(
      BILLING_MESSAGES.nothingToUpdate,
    );
    expect(updateInstallmentInputSchema.safeParse({ id: "i1", label: "Nueva" }).success).toBe(true);
    expect(cancelInstallmentInputSchema.safeParse({ id: "i1" }).success).toBe(true);
  });
});

describe("recurring charges", () => {
  const charge = {
    projectId: "p1",
    label: "Mantenimiento mensual",
    amount: "250.00",
    currency: "USD",
    frequency: "MENSUAL",
    startDate: "2026-11-01",
    billingDay: 5,
  };

  it("accepts a charge and defaults the lead days to 7", () => {
    const parsed = createRecurringChargeInputSchema.parse(charge);
    expect(parsed.leadDays).toBe(7);
  });

  it("accepts billing day 1 and 28 and rejects anything outside 1–28", () => {
    for (const day of [1, 28]) {
      expect(billingDaySchema.safeParse(day).success, String(day)).toBe(true);
    }
    for (const day of [0, 29, 31, -1, 5.5]) {
      expect(
        createRecurringChargeInputSchema.safeParse({ ...charge, billingDay: day }).success,
        String(day),
      ).toBe(false);
    }
    expect(
      messages(createRecurringChargeInputSchema.safeParse({ ...charge, billingDay: 29 })),
    ).toEqual([BILLING_MESSAGES.billingDayRange]);
  });

  it("bounds the lead days", () => {
    expect(createRecurringChargeInputSchema.safeParse({ ...charge, leadDays: 14 }).success).toBe(
      true,
    );
    expect(createRecurringChargeInputSchema.safeParse({ ...charge, leadDays: 61 }).success).toBe(
      false,
    );
    expect(createRecurringChargeInputSchema.safeParse({ ...charge, leadDays: -1 }).success).toBe(
      false,
    );
  });

  it("rejects an end date before the start date and a bad amount", () => {
    expect(
      messages(createRecurringChargeInputSchema.safeParse({ ...charge, endDate: "2026-10-01" })),
    ).toContain(BILLING_MESSAGES.endBeforeStart);
    expect(createRecurringChargeInputSchema.safeParse({ ...charge, amount: 250 }).success).toBe(
      false,
    );
    expect(
      createRecurringChargeInputSchema.safeParse({ ...charge, amount: "250.123" }).success,
    ).toBe(false);
  });

  it("update keeps the same rules; status and generation inputs", () => {
    expect(
      updateRecurringChargeInputSchema.safeParse({ ...charge, id: "rc1", billingDay: 30 }).success,
    ).toBe(false);
    expect(
      setRecurringChargeStatusInputSchema.safeParse({ id: "rc1", status: "PAUSADO" }).success,
    ).toBe(true);
    expect(
      setRecurringChargeStatusInputSchema.safeParse({ id: "rc1", status: "OTRO" }).success,
    ).toBe(false);
    expect(
      generateMissingPeriodsInputSchema.safeParse({ recurringChargeId: "rc1", upTo: "2026-12-31" })
        .success,
    ).toBe(true);
  });
});

describe("project financial summary (§8.4.4)", () => {
  const summary = {
    projectId: "p1",
    currency: "USD",
    contractedValue: "5000.00",
    invoiced: "2000.00",
    collected: "1500.00",
    toInvoice: "3000.00",
    receivable: "500.00",
    monthlyRecurring: "250.00",
    allocatedExpenses: "300.00",
    margin: "1200.00",
    marginPercent: "80.00",
  };

  it("accepts the summary and a project without a margin yet", () => {
    expect(projectFinancialSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      projectFinancialSummarySchema.safeParse({ ...summary, toInvoice: null, marginPercent: null })
        .success,
    ).toBe(true);
  });

  it("is USD only and rejects numbers", () => {
    expect(projectFinancialSummarySchema.safeParse({ ...summary, currency: "VES" }).success).toBe(
      false,
    );
    expect(projectFinancialSummarySchema.safeParse({ ...summary, collected: 1500 }).success).toBe(
      false,
    );
  });
});
