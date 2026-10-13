import { describe, expect, it } from "vitest";

import {
  canChangeInstallmentAmount,
  computeInstallmentStatus,
  installmentSumMismatch,
  splitByTemplate,
} from "./installments";

describe("splitByTemplate (HU-09, §8.4.2)", () => {
  it("CA1: 40/30/30 of 10 000 USD gives 4 000, 3 000 and 3 000", () => {
    expect(splitByTemplate("SPLIT_40_30_30", "10000")).toEqual([
      { percentage: "40", amount: "4000.00" },
      { percentage: "30", amount: "3000.00" },
      { percentage: "30", amount: "3000.00" },
    ]);
  });

  it("puts the rounding remainder on the last installment so the sum matches", () => {
    const parts = splitByTemplate("THREE_EQUAL", "100");
    expect(parts.map((part) => part.amount)).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("generates nothing for a custom plan", () => {
    expect(splitByTemplate("CUSTOM", "100")).toEqual([]);
  });
});

describe("installmentSumMismatch (HU-09 CA2)", () => {
  const plan = (amounts: [string, "CUOTA" | "AJUSTE"][]) =>
    amounts.map(([amount, kind]) => ({ amount, kind, cancelled: false }));

  it("is null when the non-AJUSTE installments add up to the contract within 0.01", () => {
    expect(
      installmentSumMismatch(
        "10000",
        plan([
          ["4000", "CUOTA"],
          ["5999.99", "CUOTA"],
        ]),
      ),
    ).toBeNull();
  });

  it("returns the difference when it is above 0.01, ignoring AJUSTE installments", () => {
    expect(
      installmentSumMismatch(
        "10000",
        plan([
          ["4000", "CUOTA"],
          ["5000", "CUOTA"],
          ["1000", "AJUSTE"],
        ]),
      ),
    ).toBe("-1000.00");
    expect(
      installmentSumMismatch(
        "10000",
        plan([
          ["4000", "CUOTA"],
          ["6000.02", "CUOTA"],
        ]),
      ),
    ).toBe("0.02");
  });

  it("leaves cancelled installments out of the sum", () => {
    expect(
      installmentSumMismatch("100", [
        { amount: "100", kind: "CUOTA", cancelled: false },
        { amount: "50", kind: "CUOTA", cancelled: true },
      ]),
    ).toBeNull();
  });
});

describe("canChangeInstallmentAmount (HU-09 CA3)", () => {
  it("locks amount and currency once a non-voided invoice line references it", () => {
    expect(canChangeInstallmentAmount([])).toBe(true);
    expect(canChangeInstallmentAmount([{ invoiceVoided: true }])).toBe(true);
    expect(canChangeInstallmentAmount([{ invoiceVoided: false }])).toBe(false);
  });
});

describe("computeInstallmentStatus (§8.4.2)", () => {
  it("is CANCELADA when cancelled by hand", () => {
    expect(computeInstallmentStatus({ cancelled: true, invoices: [] })).toBe("CANCELADA");
  });

  it("is PENDIENTE when no non-voided invoice line references it", () => {
    expect(computeInstallmentStatus({ cancelled: false, invoices: [] })).toBe("PENDIENTE");
    expect(
      computeInstallmentStatus({
        cancelled: false,
        invoices: [{ status: "ANULADA", paidAmount: "0" }],
      }),
    ).toBe("PENDIENTE");
  });

  it("is COBRADA when all its invoices are PAGADA", () => {
    expect(
      computeInstallmentStatus({
        cancelled: false,
        invoices: [
          { status: "PAGADA", paidAmount: "50" },
          { status: "PAGADA", paidAmount: "50" },
        ],
      }),
    ).toBe("COBRADA");
  });

  it("is COBRADA_PARCIAL when some invoice has payments, FACTURADA otherwise", () => {
    expect(
      computeInstallmentStatus({
        cancelled: false,
        invoices: [
          { status: "PAGADA", paidAmount: "50" },
          { status: "EMITIDA", paidAmount: "0" },
        ],
      }),
    ).toBe("COBRADA_PARCIAL");
    expect(
      computeInstallmentStatus({
        cancelled: false,
        invoices: [{ status: "EMITIDA", paidAmount: "0" }],
      }),
    ).toBe("FACTURADA");
  });
});
