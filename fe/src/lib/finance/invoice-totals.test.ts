import { describe, expect, it } from "vitest";

import { computeInvoiceTotals, type InvoiceTotalsInput } from "./invoice-totals";

const base: InvoiceTotalsInput = {
  lines: [],
  taxAdjustments: [],
  ivaWithheld: "0",
  islrWithheld: "0",
  otherWithheld: "0",
  usdRate: "1",
};

describe("computeInvoiceTotals (C17, DT-44)", () => {
  it("derives per-rate bases and IVA for lines at 16 %, 8 %, 0 % and exempt", () => {
    const totals = computeInvoiceTotals({
      ...base,
      lines: [
        { quantity: "2", unitPrice: "500", discount: "100", ivaRate: "16" },
        { quantity: "1", unitPrice: "250", discount: "0", ivaRate: "8" },
        { quantity: "1", unitPrice: "300", discount: "0", ivaRate: "0" },
        { quantity: "1", unitPrice: "150", discount: "50", ivaRate: null },
      ],
    });

    expect(totals.subtotal).toBe("1700.00");
    expect(totals.discount).toBe("150.00");
    expect(totals.exemptAmount).toBe("100.00");
    expect(totals.taxLines).toEqual([
      { ivaRate: "16", taxBase: "900.00", ivaAmount: "144.00", adjustment: "0.00" },
      { ivaRate: "8", taxBase: "250.00", ivaAmount: "20.00", adjustment: "0.00" },
      { ivaRate: "0", taxBase: "300.00", ivaAmount: "0.00", adjustment: "0.00" },
    ]);
    expect(totals.taxBase).toBe("1450.00");
    expect(totals.ivaAmount).toBe("164.00");
    expect(totals.total).toBe("1714.00");
    expect(totals.receivable).toBe("1714.00");
  });

  it("groups lines that share a rate written differently (16 and 16.00)", () => {
    const totals = computeInvoiceTotals({
      ...base,
      lines: [
        { quantity: "1", unitPrice: "100", discount: "0", ivaRate: "16" },
        { quantity: "1", unitPrice: "100", discount: "0", ivaRate: "16.00" },
      ],
    });
    expect(totals.taxLines).toHaveLength(1);
    expect(totals.taxLines[0]).toMatchObject({ taxBase: "200.00", ivaAmount: "32.00" });
  });

  it("rounds the line amount and the per-rate IVA half up to 2 decimals", () => {
    const totals = computeInvoiceTotals({
      ...base,
      lines: [{ quantity: "3", unitPrice: "33.335", discount: "0", ivaRate: "16" }],
    });
    // 3 × 33.335 = 100.005 → 100.01; 100.01 × 16 % = 16.0016 → 16.00
    expect(totals.subtotal).toBe("100.01");
    expect(totals.ivaAmount).toBe("16.00");
  });

  it("accepts a ±0.01 IVA adjustment on a rate", () => {
    const totals = computeInvoiceTotals({
      ...base,
      lines: [{ quantity: "1", unitPrice: "100", discount: "0", ivaRate: "16" }],
      taxAdjustments: [{ ivaRate: "16", adjustment: "-0.01" }],
    });
    expect(totals.taxLines[0]).toMatchObject({ ivaAmount: "15.99", adjustment: "-0.01" });
    expect(totals.total).toBe("115.99");
  });

  it("rejects a 0.02 IVA adjustment", () => {
    expect(() =>
      computeInvoiceTotals({
        ...base,
        lines: [{ quantity: "1", unitPrice: "100", discount: "0", ivaRate: "16" }],
        taxAdjustments: [{ ivaRate: "16", adjustment: "0.02" }],
      }),
    ).toThrow(RangeError);
  });

  it("rejects an adjustment on a rate no line uses, or on the 0 % rate", () => {
    const lines = [{ quantity: "1", unitPrice: "100", discount: "0", ivaRate: "0" }];
    expect(() =>
      computeInvoiceTotals({
        ...base,
        lines,
        taxAdjustments: [{ ivaRate: "16", adjustment: "0.01" }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      computeInvoiceTotals({
        ...base,
        lines,
        taxAdjustments: [{ ivaRate: "0", adjustment: "0.01" }],
      }),
    ).toThrow(RangeError);
  });

  it("rejects a line discount above its amount", () => {
    expect(() =>
      computeInvoiceTotals({
        ...base,
        lines: [{ quantity: "1", unitPrice: "100", discount: "100.01", ivaRate: "16" }],
      }),
    ).toThrow(RangeError);
  });

  it("subtracts withholdings from the receivable and snapshots both in USD", () => {
    const totals = computeInvoiceTotals({
      ...base,
      lines: [{ quantity: "1", unitPrice: "1000", discount: "0", ivaRate: "16" }],
      ivaWithheld: "120",
      islrWithheld: "20",
      otherWithheld: "0",
      usdRate: "40",
    });
    expect(totals.total).toBe("1160.00");
    expect(totals.withholdings).toBe("140.00");
    expect(totals.receivable).toBe("1020.00");
    expect(totals.totalUsd).toBe("29.00");
    expect(totals.receivableUsd).toBe("25.50");
  });
});
