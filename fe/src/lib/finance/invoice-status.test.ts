import { describe, expect, it } from "vitest";

import { computeInvoiceBalance, computeInvoiceStatus } from "./invoice-status";

const issued = {
  voided: false,
  draft: false,
  dueDate: "2026-10-31",
  receivable: "1000.00",
  paidAmount: "0.00",
};

describe("computeInvoiceBalance (§9.3)", () => {
  it("is the receivable minus what confirmed, non-voided allocations paid", () => {
    expect(
      computeInvoiceBalance("1000.00", [
        { amountInvoiceCurrency: "300.00", paymentStatus: "CONFIRMADO", voided: false },
        { amountInvoiceCurrency: "200.00", paymentStatus: "PENDIENTE_VERIFICACION", voided: false },
        { amountInvoiceCurrency: "100.00", paymentStatus: "CONFIRMADO", voided: true },
      ]),
    ).toEqual({ paidAmount: "300.00", balance: "700.00" });
  });
});

describe("computeInvoiceStatus (HU-12, §9.4)", () => {
  const today = "2026-10-13";

  it("CA1: an invoice without payments that is not overdue is EMITIDA", () => {
    expect(computeInvoiceStatus(issued, today)).toBe("EMITIDA");
  });

  it("CA2: a confirmed payment below the balance makes it PARCIAL", () => {
    expect(computeInvoiceStatus({ ...issued, paidAmount: "400.00" }, today)).toBe("PARCIAL");
  });

  it("CA3: a balance at or below 0.01 makes it PAGADA", () => {
    expect(computeInvoiceStatus({ ...issued, paidAmount: "999.99" }, today)).toBe("PAGADA");
    expect(computeInvoiceStatus({ ...issued, paidAmount: "999.98" }, today)).toBe("PARCIAL");
  });

  it("CA4: past the due date with a balance it is VENCIDA, even with partial payments", () => {
    expect(computeInvoiceStatus({ ...issued, dueDate: "2026-10-12" }, today)).toBe("VENCIDA");
    expect(
      computeInvoiceStatus({ ...issued, dueDate: "2026-10-12", paidAmount: "400.00" }, today),
    ).toBe("VENCIDA");
    expect(computeInvoiceStatus({ ...issued, dueDate: today }, today)).toBe("EMITIDA");
  });

  it("voided wins over everything, then draft", () => {
    expect(computeInvoiceStatus({ ...issued, voided: true, draft: true }, today)).toBe("ANULADA");
    expect(computeInvoiceStatus({ ...issued, draft: true }, today)).toBe("BORRADOR");
  });
});
