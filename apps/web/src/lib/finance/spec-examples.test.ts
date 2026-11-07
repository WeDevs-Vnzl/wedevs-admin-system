// T10 phase A regression tests (odd/tasks/h1-b3-finance-ui.md): the spec examples of S2-S10 over lib/finance.
import { describe, expect, it } from "vitest";
import {
  allocationProblems,
  computeInvoiceTotals,
  computePaymentAmounts,
  installmentSumMismatch,
  proposeAllocation,
  splitByTemplate,
} from "@/lib/finance";

const base = { ivaWithheld: "0", islrWithheld: "0", otherWithheld: "0", usdRate: "1" };
const line = (unitPrice: string, ivaRate: string | null, discount = "0", quantity = "1") => ({
  quantity,
  unitPrice,
  discount,
  ivaRate,
});

describe("S2 DT-44", () => {
  it("lines at 16, 8, 0 and exempt with discounts", () => {
    const t = computeInvoiceTotals({
      ...base,
      lines: [
        line("1000", "16", "100"),
        line("500", "8"),
        line("200", "0"),
        line("300", null, "50"),
        line("33.33", "16", "0", "3"),
      ],
      taxAdjustments: [],
    });
    expect(t.subtotal).toBe("2099.99");
    expect(t.discount).toBe("150.00");
    expect(t.exemptAmount).toBe("250.00");
    const by = Object.fromEntries(t.taxLines.map((x) => [x.ivaRate, x]));
    expect(by["16"]!.taxBase).toBe("999.99");
    expect(by["16"]!.ivaAmount).toBe("160.00"); // 159.9984 → 160.00
    expect(by["8"]!.ivaAmount).toBe("40.00");
    expect(by["0"]!.ivaAmount).toBe("0.00");
    expect(by["0"]!.taxBase).toBe("200.00");
    expect(t.taxBase).toBe("1699.99");
    expect(t.ivaAmount).toBe("200.00");
    expect(t.total).toBe("2149.99");
  });
  it("±0.01 accepted, 0.02 rejected, 0 % rate cannot be adjusted", () => {
    const mk = (adjustment: string, ivaRate = "16") =>
      computeInvoiceTotals({
        ...base,
        lines: [line("100", "16"), line("100", "0")],
        taxAdjustments: [{ ivaRate, adjustment }],
      });
    expect(mk("0.01").ivaAmount).toBe("16.01");
    expect(mk("-0.01").ivaAmount).toBe("15.99");
    expect(() => mk("0.02")).toThrow(RangeError);
    expect(() => mk("-0.02")).toThrow(RangeError);
    expect(() => mk("0.011")).toThrow(RangeError);
    expect(() => mk("0.01", "0")).toThrow(RangeError);
    expect(() => mk("0.01", "8")).toThrow(RangeError);
  });
  it("withholdings, receivable and USD snapshot", () => {
    const t = computeInvoiceTotals({
      lines: [line("1000", "16")],
      taxAdjustments: [],
      ivaWithheld: "120",
      islrWithheld: "20",
      otherWithheld: "0",
      usdRate: "36.5",
    });
    expect(t.total).toBe("1160.00");
    expect(t.receivable).toBe("1020.00");
    expect(t.totalUsd).toBe("31.78");
    expect(t.receivableUsd).toBe("27.95");
  });
  it("discount above amount rejected", () => {
    expect(() =>
      computeInvoiceTotals({ ...base, lines: [line("10", "16", "10.01")], taxAdjustments: [] }),
    ).toThrow(RangeError);
  });
});

describe("S3 HU-09", () => {
  it("CA1 40/30/30 of 10000 and remainder on last", () => {
    expect(splitByTemplate("SPLIT_40_30_30", "10000").map((x) => x.amount)).toEqual([
      "4000.00",
      "3000.00",
      "3000.00",
    ]);
    const odd = splitByTemplate("SPLIT_40_30_30", "100.01").map((x) => x.amount);
    expect(odd.reduce((a, b) => a + Number(b), 0).toFixed(2)).toBe("100.01");
  });
  it("CA2 mismatch > 0.01, AJUSTE ignored", () => {
    const k = (amount: string, kind = "CUOTA") => ({
      amount,
      kind: kind as never,
      cancelled: false,
    });
    expect(installmentSumMismatch("10000", [k("4000"), k("3000"), k("3000.01")])).toBeNull();
    expect(installmentSumMismatch("10000", [k("4000"), k("3000"), k("3000.02")])).toBe("0.02");
    expect(
      installmentSumMismatch("10000", [k("4000"), k("3000"), k("3000"), k("50", "AJUSTE")]),
    ).toBeNull();
  });
});

describe("S7 HU-13", () => {
  it("CA2 100 USD IGTF 3 fee 0", () => {
    expect(
      computePaymentAmounts({ amount: "100", igtfAmount: "3", feeAmount: "0", allocated: [] }),
    ).toEqual({
      allocatable: "97.00",
      netCredited: "100.00",
      unallocated: "97.00",
    });
  });
  it("CA3", () => {
    expect(
      allocationProblems("97", [
        { amountPaymentCurrency: "97", amountInvoiceCurrency: "97", invoiceBalance: "97" },
      ]),
    ).toEqual([]);
    expect(
      allocationProblems("97", [
        { amountPaymentCurrency: "97.01", amountInvoiceCurrency: "50", invoiceBalance: "97" },
      ]),
    ).toEqual([{ kind: "exceedsAllocatable" }]);
    expect(
      allocationProblems("97", [
        { amountPaymentCurrency: "50", amountInvoiceCurrency: "50", invoiceBalance: "49.99" },
      ]),
    ).toEqual([{ kind: "exceedsInvoiceBalance", index: 0 }]);
  });
  it("CA4 VES → USD", () => {
    expect(
      proposeAllocation({
        amountPaymentCurrency: "3650",
        paymentCurrency: "VES",
        paymentUsdRate: "36.5",
        invoiceCurrency: "USD",
        invoiceUsdRateOnPaymentDate: "1",
      }),
    ).toEqual({ amountUsd: "100.00", amountInvoiceCurrency: "100.00" });
  });
});
