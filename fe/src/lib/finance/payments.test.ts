import { describe, expect, it } from "vitest";

import { allocationProblems, computePaymentAmounts, proposeAllocation } from "./payments";

describe("computePaymentAmounts (HU-13 CA2, §9.6)", () => {
  it("CA2: 100 USD with IGTF 3 and fee 0 leaves 97 allocatable and credits 100", () => {
    expect(
      computePaymentAmounts({ amount: "100", igtfAmount: "3", feeAmount: "0", allocated: [] }),
    ).toEqual({ allocatable: "97.00", netCredited: "100.00", unallocated: "97.00" });
  });

  it("CA5: what is not allocated stays as credit", () => {
    expect(
      computePaymentAmounts({
        amount: "100",
        igtfAmount: "3",
        feeAmount: "2",
        allocated: ["50", "20"],
      }),
    ).toEqual({ allocatable: "97.00", netCredited: "98.00", unallocated: "27.00" });
  });
});

describe("allocationProblems (HU-13 CA3)", () => {
  it("is empty when the allocations fit the allocatable amount and each invoice balance", () => {
    expect(
      allocationProblems("97", [
        { amountPaymentCurrency: "60", amountInvoiceCurrency: "60", invoiceBalance: "60" },
        { amountPaymentCurrency: "37", amountInvoiceCurrency: "37", invoiceBalance: "100" },
      ]),
    ).toEqual([]);
  });

  it("flags a sum above the allocatable amount", () => {
    expect(
      allocationProblems("97", [
        { amountPaymentCurrency: "60", amountInvoiceCurrency: "60", invoiceBalance: "60" },
        { amountPaymentCurrency: "38", amountInvoiceCurrency: "38", invoiceBalance: "100" },
      ]),
    ).toEqual([{ kind: "exceedsAllocatable" }]);
  });

  it("flags each allocation above its invoice balance", () => {
    expect(
      allocationProblems("97", [
        { amountPaymentCurrency: "60", amountInvoiceCurrency: "60.01", invoiceBalance: "60" },
      ]),
    ).toEqual([{ kind: "exceedsInvoiceBalance", index: 0 }]);
  });
});

describe("proposeAllocation (HU-13 CA4, §9.5)", () => {
  it("CA4: a VES payment on a USD invoice proposes USD at the payment-day rate", () => {
    expect(
      proposeAllocation({
        amountPaymentCurrency: "4000",
        paymentCurrency: "VES",
        paymentUsdRate: "40",
        invoiceCurrency: "USD",
        invoiceUsdRateOnPaymentDate: "1",
      }),
    ).toEqual({ amountUsd: "100.00", amountInvoiceCurrency: "100.00" });
  });

  it("goes through USD between two non-USD currencies", () => {
    expect(
      proposeAllocation({
        amountPaymentCurrency: "92",
        paymentCurrency: "EUR",
        paymentUsdRate: "0.92",
        invoiceCurrency: "VES",
        invoiceUsdRateOnPaymentDate: "40",
      }),
    ).toEqual({ amountUsd: "100.00", amountInvoiceCurrency: "4000.00" });
  });

  it("keeps the same amount when both currencies match", () => {
    expect(
      proposeAllocation({
        amountPaymentCurrency: "4000",
        paymentCurrency: "VES",
        paymentUsdRate: "40",
        invoiceCurrency: "VES",
        invoiceUsdRateOnPaymentDate: "41",
      }),
    ).toEqual({ amountUsd: "100.00", amountInvoiceCurrency: "4000.00" });
  });
});
