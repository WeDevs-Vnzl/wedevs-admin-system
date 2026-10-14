// T10 phase A regression tests (odd/tasks/h1-b3-finance-ui.md): the spec examples of S2-S10 over lib/finance.
import { describe, expect, it } from "vitest";
import {
  accountBalance,
  accountLedger,
  allocationProblems,
  computeInvoiceStatus,
  computeInvoiceTotals,
  computePaymentAmounts,
  dueRecurringPeriods,
  installmentSumMismatch,
  proposeAllocation,
  reconciliationAdjustment,
  splitByTemplate,
  transferProblem,
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

describe("S4 HU-10 CA1 schedule", () => {
  const sched = {
    frequency: "MENSUAL" as const,
    startDate: "2026-01-01",
    endDate: null,
    billingDay: 5,
    leadDays: 7,
    status: "ACTIVO" as const,
  };
  it("day 5, lead 7 → generated on 28/29 of previous month", () => {
    expect(dueRecurringPeriods(sched, ["2026-04-05"], "2026-04-27")).toEqual([]);
    expect(dueRecurringPeriods(sched, ["2026-04-05"], "2026-04-28")).toHaveLength(1);
    expect(dueRecurringPeriods(sched, ["2026-04-05", "2026-05-05"], "2026-04-28")).toHaveLength(0);
  });
  it("generateOn values", () => {
    const g = (last: string) => dueRecurringPeriods(sched, [last], "2027-12-31")[0]!.generateOn;
    expect(g("2026-04-05")).toBe("2026-04-28"); // May 5 − 7 (April has 30)
    expect(g("2026-03-05")).toBe("2026-03-29"); // Apr 5 − 7 (March has 31)
    expect(g("2026-02-05")).toBe("2026-02-26"); // Mar 5 − 7 (Feb 28) — outside "28 o 29"
    expect(dueRecurringPeriods({ ...sched, status: "PAUSADO" }, [], "2027-01-01")).toEqual([]);
  });
});

describe("S6 HU-12 status", () => {
  const inv = {
    voided: false,
    draft: false,
    dueDate: "2026-10-20",
    receivable: "100.00",
    paidAmount: "0.00",
  };
  it("CA1-CA4", () => {
    expect(computeInvoiceStatus(inv, "2026-10-09")).toBe("EMITIDA");
    expect(computeInvoiceStatus({ ...inv, paidAmount: "50" }, "2026-10-09")).toBe("PARCIAL");
    expect(computeInvoiceStatus({ ...inv, paidAmount: "99.99" }, "2026-10-09")).toBe("PAGADA");
    expect(computeInvoiceStatus({ ...inv, paidAmount: "99.98" }, "2026-10-09")).toBe("PARCIAL");
    expect(computeInvoiceStatus({ ...inv, paidAmount: "50" }, "2026-10-21")).toBe("VENCIDA");
    expect(computeInvoiceStatus({ ...inv }, "2026-10-20")).toBe("EMITIDA");
    expect(computeInvoiceStatus({ ...inv, paidAmount: "99.99" }, "2026-10-21")).toBe("PAGADA");
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

describe("S9/S10", () => {
  const empty = {
    openingBalance: "100",
    payments: [],
    expenses: [],
    transfersIn: [],
    transfersOut: [],
    movements: [],
  };
  it("§9.7 with accountAmount and running balance", () => {
    const act = {
      ...empty,
      payments: [
        { date: "2026-01-02", netCredited: "50", status: "CONFIRMADO" as const },
        { date: "2026-01-02", netCredited: "999", status: "PENDIENTE" as never },
      ],
      expenses: [
        { date: "2026-01-03", amount: "10", accountAmount: "365", status: "PAGADO" as const },
        { date: "2026-01-03", amount: "10", accountAmount: null, status: "PENDIENTE" as const },
      ],
      transfersOut: [{ date: "2026-01-04", amountFrom: "20", feeAmount: "1" }],
      transfersIn: [{ date: "2026-01-05", amountTo: "5" }],
      movements: [
        { date: "2026-01-06", type: "RETIRO_SOCIO" as const, amount: "4" },
        { date: "2026-01-06", type: "AJUSTE" as const, amount: "-0.5" },
      ],
    };
    expect(accountBalance(act, "2026-12-31")).toBe("-235.50");
    expect(accountLedger(act, "2026-12-31").map((e) => e.balance)).toEqual([
      "150.00",
      "-215.00",
      "-236.00",
      "-231.00",
      "-235.00",
      "-235.50",
    ]);
    expect(reconciliationAdjustment("-235.50", "-230")).toBe("5.50");
    expect(reconciliationAdjustment("10", "10.00")).toBeNull();
  });
  it("transfer 100 → 99", () => {
    const zelle = accountBalance(
      {
        ...empty,
        openingBalance: "0",
        transfersOut: [{ date: "2026-01-01", amountFrom: "100", feeAmount: "0" }],
      },
      "2026-12-31",
    );
    const bin = accountBalance(
      { ...empty, openingBalance: "0", transfersIn: [{ date: "2026-01-01", amountTo: "99" }] },
      "2026-12-31",
    );
    expect([zelle, bin]).toEqual(["-100.00", "99.00"]);
    expect(transferProblem("a", "a")).toBe("sameAccount");
  });
});
