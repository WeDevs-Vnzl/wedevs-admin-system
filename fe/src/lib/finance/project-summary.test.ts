import { describe, expect, it } from "vitest";

import { computeProjectSummary, type ProjectSummaryInput } from "./project-summary";

const base: ProjectSummaryInput = {
  model: "PRECIO_FIJO",
  contractedUsd: "10000.00",
  adjustmentsUsd: [],
  lines: [],
  monthlyRecurringUsd: [],
  allocatedExpensesUsd: "0.00",
};

describe("computeProjectSummary (PRD §8.4.4)", () => {
  it("adds the adjustments to the contracted value and leaves the rest to invoice", () => {
    const summary = computeProjectSummary({
      ...base,
      adjustmentsUsd: ["500.00", "-200.00"],
      lines: [{ netAmountUsd: "4000.00", invoiceReceivable: "4640.00", invoicePaid: "0.00" }],
    });
    expect(summary).toMatchObject({
      contractedValue: "10300.00",
      invoiced: "4000.00",
      collected: "0.00",
      toInvoice: "6300.00",
      receivable: "4000.00",
    });
  });

  it("collects each line in proportion to what its invoice has paid", () => {
    const summary = computeProjectSummary({
      ...base,
      lines: [
        // Half of the invoice is paid: half of the line is collected.
        { netAmountUsd: "1000.00", invoiceReceivable: "1160.00", invoicePaid: "580.00" },
        // Fully paid invoice in another currency: the whole line.
        { netAmountUsd: "250.00", invoiceReceivable: "11600.00", invoicePaid: "11600.00" },
        // Nothing paid.
        { netAmountUsd: "300.00", invoiceReceivable: "348.00", invoicePaid: "0.00" },
      ],
    });
    expect(summary.invoiced).toBe("1550.00");
    expect(summary.collected).toBe("750.00");
    expect(summary.receivable).toBe("800.00");
  });

  it("counts a line of an invoice with nothing receivable as collected", () => {
    const summary = computeProjectSummary({
      ...base,
      lines: [{ netAmountUsd: "100.00", invoiceReceivable: "0.00", invoicePaid: "0.00" }],
    });
    expect(summary.collected).toBe("100.00");
  });

  it.each(["PRECIO_FIJO", "MIXTO"] as const)("%s has an amount to invoice", (model) => {
    expect(computeProjectSummary({ ...base, model }).toInvoice).toBe("10000.00");
  });

  it("has nothing to invoice for a recurring plan or a project without a plan", () => {
    expect(
      computeProjectSummary({ ...base, model: "RECURRENTE", contractedUsd: null }).toInvoice,
    ).toBeNull();
    expect(computeProjectSummary({ ...base, model: null, contractedUsd: null })).toMatchObject({
      contractedValue: "0.00",
      toInvoice: null,
    });
  });

  it("sums the monthly recurring charges and computes the margin over collected", () => {
    const summary = computeProjectSummary({
      ...base,
      lines: [{ netAmountUsd: "2000.00", invoiceReceivable: "2000.00", invoicePaid: "2000.00" }],
      monthlyRecurringUsd: ["150.00", "50.00"],
      allocatedExpensesUsd: "500.00",
    });
    expect(summary).toMatchObject({
      monthlyRecurring: "200.00",
      allocatedExpenses: "500.00",
      margin: "1500.00",
      marginPercent: "75.00",
    });
  });

  it("has no margin percent while nothing is collected", () => {
    const summary = computeProjectSummary({ ...base, allocatedExpensesUsd: "80.00" });
    expect(summary.margin).toBe("-80.00");
    expect(summary.marginPercent).toBeNull();
  });
});
