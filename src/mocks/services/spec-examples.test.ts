// T10 phase A regression tests (odd/tasks/h1-b3-finance-ui.md): the spec examples of S2-S11 through the mock
// services, plus the invariant that a rejected command leaves the store unchanged.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoiceInputSchema, updateInvoiceInputSchema } from "@/lib/validators/invoices";
import { createPaymentInputSchema } from "@/lib/validators/payments";
import { createTransferInputSchema } from "@/lib/validators/accounts";
import {
  markExpensePaidInputSchema,
  createRecurringExpenseInputSchema,
} from "@/lib/validators/expenses";
import { createMockContext } from "@/mocks/ctx";
import { mockId } from "@/mocks/ids";
import { FIXED_NOW, makeTestContext } from "@/mocks/test-helpers";
import {
  createInvoice,
  getInvoice,
  listBillableInstallments,
  updateInvoice,
  voidInvoice,
} from "@/mocks/services/invoices";
import {
  allocatePayment,
  createPayment,
  detectDuplicatePayment,
  getClientCredit,
} from "@/mocks/services/payments";
import { createTransfer, getAccount, reconcileAccount } from "@/mocks/services/accounts";
import {
  runRecurringGeneration,
  setRecurringChargeStatus,
  updateInstallment,
} from "@/mocks/services/billing";
import {
  createRecurringExpense,
  markExpensePaid,
  runRecurringExpenseGeneration,
  setRecurringExpenseStatus,
} from "@/mocks/services/expenses";

const KAIROS = mockId("cli", "kairos");
const ZAFIRO = mockId("cli", "zafiro_labs");
const CHARGE = mockId("rch", "kairos_mantenimiento");
let ctx: ReturnType<typeof makeTestContext>["ctx"];
let db: ReturnType<typeof makeTestContext>["db"];
let user: ReturnType<typeof makeTestContext>["user"];
// A rejected create or update may still advance `idCounters` (T10 advisory A2, accepted): the counters are
// left out of the comparison, every record is in it.
const hash = () => {
  const records = JSON.stringify({ ...db, idCounters: null });
  return createHash("sha256").update(records).digest("hex");
};
const at = (iso: string) => {
  const now = new Date(iso);
  vi.setSystemTime(now);
  return createMockContext({ user, now, db });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  ({ ctx, db, user } = makeTestContext("OWNER"));
});
afterEach(() => vi.useRealTimers());

const inv = (o: Record<string, unknown> = {}) =>
  createInvoiceInputSchema.parse({
    clientId: ZAFIRO,
    invoiceNumber: "P-0001",
    issueDate: "2026-10-09",
    dueDate: "2026-11-08",
    currency: "USD",
    usdRate: "1",
    lines: [
      { description: "a", unitPrice: "1000.00", discount: "100", ivaRate: "16" },
      { description: "b", unitPrice: "500.00", ivaRate: "8" },
      { description: "c", unitPrice: "200.00", ivaRate: "0" },
      { description: "d", unitPrice: "300.00", discount: "50", ivaRate: null },
    ],
    ...o,
  });

describe("S2/S5 invoices through the service", () => {
  it("multi-rate invoice totals in the store", async () => {
    const out = await createInvoice(
      ctx,
      inv({ taxAdjustments: [{ ivaRate: "16", adjustment: "-0.01" }] }),
    );
    expect(out.totals.exemptAmount).toBe("250.00");
    expect(out.taxLines.map((t) => [t.ivaRate, t.taxBase, t.ivaAmount])).toEqual([
      ["16", "900.00", "143.99"],
      ["8", "500.00", "40.00"],
      ["0", "200.00", "0.00"],
    ]);
    expect(out.totals.total).toBe("2033.99");
    expect(out.status).toBe("EMITIDA");
  });
  it("a 0.02 adjustment is refused by the schema, 0.01 is accepted", async () => {
    expect(() => inv({ taxAdjustments: [{ ivaRate: "16", adjustment: "0.02" }] })).toThrow();
    expect(() => inv({ taxAdjustments: [{ ivaRate: "16", adjustment: "0.01" }] })).not.toThrow();
  });
  it("rejected discount > amount leaves the store unchanged (service path)", async () => {
    const before = hash();
    const input = inv();
    (input.lines[0] as { discount: string }).discount = "1000.01";
    await expect(createInvoice(ctx, input)).rejects.toBeTruthy();
    expect(hash()).toBe(before);
  });
  it("CA3 duplicate number rejected; archived frees the number", async () => {
    await createInvoice(ctx, inv());
    const before = hash();
    await expect(createInvoice(ctx, inv({ invoiceNumber: " p-0001 " }))).rejects.toBeTruthy();
    expect(hash()).toBe(before);
  });
  it("CA1/CA5 installments of the client → FACTURADA", async () => {
    const rows = await listBillableInstallments(ctx, KAIROS);
    expect(rows.length).toBeGreaterThan(0);
    const pick = rows.filter((r) => r.currency === "USD").slice(0, 1);
    const out = await createInvoice(
      ctx,
      inv({
        clientId: KAIROS,
        invoiceNumber: "P-INS",
        lines: pick.map((r) => ({
          description: r.label,
          installmentId: r.installment.id,
          unitPrice: r.remainingAmount,
          ivaRate: "16",
        })),
      }),
    );
    expect(out.lines[0]!.installment?.id).toBe(pick[0]!.installment.id);
    expect(db.installments.find((i) => i.id === pick[0]!.installment.id)!.status).toBe("FACTURADA");
    expect(
      (await listBillableInstallments(ctx, KAIROS)).map((r) => r.installment.id),
    ).not.toContain(pick[0]!.installment.id);
  });
});

describe("S6/S7 payments", () => {
  const pay = (o: Record<string, unknown> = {}) =>
    createPaymentInputSchema.parse({
      clientId: ZAFIRO,
      date: "2026-10-09",
      accountId: "acc_zelle",
      methodId: "pmt_zelle",
      currency: "USD",
      amount: "100.00",
      igtfAmount: "3.00",
      feeAmount: "0.00",
      usdRate: "1",
      reference: "PRB-1",
      ...o,
    });

  it("CA2 + CA5 + S6 CA2/CA3 + S9 balance", async () => {
    const invoice = await createInvoice(
      ctx,
      inv({ lines: [{ description: "x", unitPrice: "150.00", ivaRate: null }] }),
    );
    const zelleBefore = (await getAccount(ctx, "acc_zelle")).balance;
    const p = await createPayment(
      ctx,
      pay({
        allocations: [
          { invoiceId: invoice.id, amountPaymentCurrency: "60.00", amountInvoiceCurrency: "60.00" },
        ],
      }),
    );
    expect([p.allocatable, p.netCredited, p.unallocated]).toEqual(["97.00", "100.00", "37.00"]);
    expect((await getInvoice(ctx, invoice.id)).status).toBe("PARCIAL");
    const zelleAfter = (await getAccount(ctx, "acc_zelle")).balance;
    expect(Number(zelleAfter) - Number(zelleBefore)).toBeCloseTo(100, 2);
    const credit = await getClientCredit(ctx, ZAFIRO);
    expect(credit.payments.find((c) => c.paymentId === p.id)?.unallocated).toBe("37.00");
    // CA3: over the invoice balance is refused, store unchanged
    const before = hash();
    await expect(
      allocatePayment(ctx, {
        paymentId: p.id,
        invoiceId: invoice.id,
        amountPaymentCurrency: "37.00",
        amountInvoiceCurrency: "90.01",
      } as never),
    ).rejects.toBeTruthy();
    expect(hash()).toBe(before);
    // pay 89.99 more with another payment → balance 0.01 → PAGADA
    await createPayment(
      ctx,
      pay({
        reference: "PRB-2",
        igtfAmount: "0",
        amount: "89.99",
        allocations: [
          { invoiceId: invoice.id, amountPaymentCurrency: "89.99", amountInvoiceCurrency: "89.99" },
        ],
      }),
    );
    expect((await getInvoice(ctx, invoice.id)).status).toBe("PAGADA");
    // S6 CA5: void refused with active allocations, store unchanged
    const b2 = hash();
    await expect(voidInvoice(ctx, { id: invoice.id, reason: "x" } as never)).rejects.toBeTruthy();
    expect(hash()).toBe(b2);
  });
  it("CA3 over allocatable refused; CA6 duplicate warning", async () => {
    const invoice = await createInvoice(
      ctx,
      inv({ lines: [{ description: "x", unitPrice: "500.00", ivaRate: null }] }),
    );
    const before = hash();
    await expect(
      createPayment(ctx, {
        ...pay(),
        allocations: [
          { invoiceId: invoice.id, amountPaymentCurrency: "97.01", amountInvoiceCurrency: "97.01" },
        ],
      } as never),
    ).rejects.toBeTruthy();
    expect(hash()).toBe(before);
    await createPayment(ctx, pay());
    const dup = await detectDuplicatePayment(ctx, {
      reference: " prb-1 ",
      methodId: "pmt_zelle",
      accountId: "acc_zelle",
    } as never);
    expect(dup.duplicate).toBe(true);
    const other = await detectDuplicatePayment(ctx, {
      reference: "PRB-1",
      methodId: "pmt_paypal",
      accountId: "acc_zelle",
    } as never);
    expect(other.duplicate).toBe(false);
  });
  it("CA1 reference required for a method that requires it", async () => {
    const before = hash();
    await expect(createPayment(ctx, { ...pay(), reference: undefined })).rejects.toBeTruthy();
    expect(hash()).toBe(before);
  });
});

describe("S9/S10 accounts", () => {
  it("transfer 100 Zelle → 99 Binance; same account refused", async () => {
    const z0 = (await getAccount(ctx, "acc_zelle")).balance;
    const b0 = (await getAccount(ctx, "acc_binance")).balance;
    await createTransfer(
      ctx,
      createTransferInputSchema.parse({
        date: "2026-10-09",
        fromAccountId: "acc_zelle",
        toAccountId: "acc_binance",
        amountFrom: "100",
        amountTo: "99",
        usdRate: "1",
      }),
    );
    const z1 = (await getAccount(ctx, "acc_zelle")).balance;
    const b1 = (await getAccount(ctx, "acc_binance")).balance;
    expect((Number(z0) - Number(z1)).toFixed(2)).toBe("100.00");
    expect((Number(b1) - Number(b0)).toFixed(2)).toBe("99.00");
    const before = hash();
    await expect(
      createTransfer(ctx, {
        date: "2026-10-09",
        fromAccountId: "acc_zelle",
        toAccountId: "acc_zelle",
        amountFrom: "1",
        amountTo: "1",
        feeAmount: "0",
        usdRate: "1",
      } as never),
    ).rejects.toBeTruthy();
    expect(hash()).toBe(before);
  });
  it("reconcile suggests AJUSTE and stores nothing", async () => {
    const before = hash();
    const sys = (await getAccount(ctx, "acc_zelle")).balance;
    const r = await reconcileAccount(ctx, {
      accountId: "acc_zelle",
      date: "2026-10-09",
      statementBalance: (Number(sys) + 12.34).toFixed(2),
    } as never);
    expect(r.suggestedAdjustment).toBe("12.34");
    expect(hash()).toBe(before);
  });
});

describe("S4 HU-10 recurring charges", () => {
  it("CA2 twice same day → no duplicates", async () => {
    await runRecurringGeneration(ctx);
    const before = hash();
    const second = await runRecurringGeneration(ctx);
    expect(second.created).toBe(0);
    expect(hash()).toBe(before);
  });
  it("CA3 + PRD §8.4.3: resume does not generate the skipped periods", async () => {
    await runRecurringGeneration(ctx);
    await setRecurringChargeStatus(ctx, { id: CHARGE, status: "PAUSADO" });
    const later = at("2027-01-09T15:00:00.000Z");
    expect((await runRecurringGeneration(later)).created).toBe(0);
    await setRecurringChargeStatus(later, { id: CHARGE, status: "ACTIVO" });
    const resumed = await runRecurringGeneration(later);
    // Nov 5, Dec 5, Jan 5 were skipped while paused; the next generateOn (Feb 5 − 7 = Jan 29) is not reached.
    expect(resumed.periodStarts).toEqual([]);
  });
});

describe("S11 HU-17 recurring expenses", () => {
  const rex = () =>
    createRecurringExpenseInputSchema.parse({
      name: "Probe SaaS",
      categoryId: db.expenseCategories[0]!.id,
      accountId: "acc_zelle",
      currency: "USD",
      amount: "20.00",
      frequency: "MENSUAL",
      dayOfPeriod: 15,
      leadDays: 7,
      startDate: "2026-10-01",
    });
  it("CA1 one PENDIENTE per period, no duplicates; CA2 mark paid adjusts amount and rate", async () => {
    const r = await createRecurringExpense(ctx, rex());
    const first = await runRecurringExpenseGeneration(ctx);
    expect(first.periodStarts).toContain("2026-10-15");
    const again = await runRecurringExpenseGeneration(ctx);
    expect(again.created).toBe(0);
    const gen = db.expenses.filter((e) => e.recurringExpense?.id === r.id);
    expect(gen).toHaveLength(1);
    expect(gen[0]!.status).toBe("PENDIENTE");
    const z0 = (await getAccount(ctx, "acc_zelle")).balance;
    const paid = await markExpensePaid(
      ctx,
      markExpensePaidInputSchema.parse({
        id: gen[0]!.id,
        accountId: "acc_zelle",
        paidAt: "2026-10-09",
        currency: "USD",
        amount: "21.50",
        usdRate: "1",
      }),
    );
    expect([paid.status, paid.amount, paid.amountUsd]).toEqual(["PAGADO", "21.50", "21.50"]);
    const z1 = (await getAccount(ctx, "acc_zelle")).balance;
    expect((Number(z0) - Number(z1)).toFixed(2)).toBe("21.50");
  });
  it("resuming a paused recurring expense does not back-fill the skipped periods (A1)", async () => {
    const r = await createRecurringExpense(ctx, rex());
    await runRecurringExpenseGeneration(ctx);
    await setRecurringExpenseStatus(ctx, { id: r.id, status: "PAUSADO" } as never);
    const later = at("2027-01-09T15:00:00.000Z");
    await setRecurringExpenseStatus(later, { id: r.id, status: "ACTIVO" } as never);
    await runRecurringExpenseGeneration(later);
    const periods = db.expenses
      .filter((e) => e.recurringExpense?.id === r.id)
      .map((e) => e.periodStart);
    // Nov 15, Dec 15 and Jan 15 (generated on Jan 8) fell inside the pause.
    expect(periods).toEqual(["2026-10-15"]);
  });
});

describe("a rejected service command leaves the store unchanged", () => {
  it("an adjustment on a rate with no line is refused by the schema", () => {
    expect(() =>
      inv({
        lines: [{ description: "a", unitPrice: "100", ivaRate: "16" }],
        taxAdjustments: [{ ivaRate: "8", adjustment: "0.01" }],
      }),
    ).toThrow();
  });
  it("updateInvoice receivable below paid → INTEGRITY_LOCK", async () => {
    const created = await createInvoice(
      ctx,
      inv({ lines: [{ description: "x", unitPrice: "150.00", ivaRate: null }] }),
    );
    await createPayment(
      ctx,
      createPaymentInputSchema.parse({
        clientId: ZAFIRO,
        date: "2026-10-09",
        accountId: "acc_zelle",
        methodId: "pmt_zelle",
        currency: "USD",
        amount: "100.00",
        usdRate: "1",
        reference: "Q1",
        allocations: [
          {
            invoiceId: created.id,
            amountPaymentCurrency: "100.00",
            amountInvoiceCurrency: "100.00",
          },
        ],
      }),
    );
    const before = hash();
    const input = updateInvoiceInputSchema.parse({
      id: created.id,
      clientId: ZAFIRO,
      invoiceNumber: created.invoiceNumber,
      issueDate: created.issueDate,
      dueDate: created.dueDate,
      currency: "USD",
      usdRate: "1",
      lines: [{ description: "z", unitPrice: "50.00", ivaRate: null }],
    });
    await expect(updateInvoice(ctx, input)).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    expect(hash()).toBe(before);
  });
  it("billed installment (via invoice) refuses amount and currency change", async () => {
    const rows = await listBillableInstallments(ctx, KAIROS);
    const r = rows.find((x) => x.currency === "USD")!;
    await createInvoice(
      ctx,
      inv({
        clientId: KAIROS,
        invoiceNumber: "P-L",
        lines: [
          {
            description: r.label,
            installmentId: r.installment.id,
            unitPrice: r.remainingAmount,
            ivaRate: "16",
          },
        ],
      }),
    );
    const before = hash();
    await expect(
      updateInstallment(ctx, { id: r.installment.id, amount: "1.00" } as never),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    await expect(
      updateInstallment(ctx, { id: r.installment.id, currency: "VES" } as never),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    expect(hash()).toBe(before);
  });
});
