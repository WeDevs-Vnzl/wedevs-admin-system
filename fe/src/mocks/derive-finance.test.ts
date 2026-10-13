import { beforeEach, describe, expect, it } from "vitest";

import type { RecurringChargeDTO } from "@/lib/validators/billing";
import { deriveFinance } from "./derive-finance";
import {
  makeAccount,
  makeAllocation,
  makeInstallment,
  makeInvoice,
  makePayment,
  makePlan,
  STAMP,
} from "./finance-test-factories";
import { buildMockStore, type MockStore } from "./store";

const TODAY = "2026-10-13";
let store: MockStore;

beforeEach(() => {
  store = buildMockStore(new Date(`${TODAY}T15:00:00.000Z`));
  store.accounts = [makeAccount()];
  store.invoices = [makeInvoice()];
  store.invoiceTaxLines = [];
  store.payments = [makePayment()];
  store.paymentAllocations = [makeAllocation()];
  store.installments = [makeInstallment()];
  store.billingPlans = [makePlan()];
  store.recurringCharges = [];
  store.expenses = [];
  store.transfers = [];
  store.movements = [];
});

describe("deriveFinance (C17 through the store)", () => {
  it("recomputes invoice lines, per-rate tax lines and totals from the stored inputs", () => {
    deriveFinance(store, TODAY);
    const [inv] = store.invoices;

    expect(inv!.lines.map((item) => [item.amount, item.netAmount])).toEqual([
      ["1000.00", "1000.00"],
      ["200.00", "200.00"],
    ]);
    expect(inv!.taxLines).toEqual([
      { ivaRate: "16", taxBase: "1000.00", ivaAmount: "160.00", adjustment: "0.00" },
    ]);
    expect(inv!.totals).toMatchObject({
      subtotal: "1200.00",
      exemptAmount: "200.00",
      total: "1360.00",
      receivable: "1360.00",
      paidAmount: "400.00",
      balance: "960.00",
      balanceUsd: "960.00",
    });
    expect(store.invoiceTaxLines).toEqual([
      expect.objectContaining({ invoiceId: "inv_1", ivaRate: "16", ivaAmount: "160.00" }),
    ]);
  });

  it("keeps a stored IVA adjustment and derives status and allocations", () => {
    store.invoices[0]!.taxLines = [
      { ivaRate: "16", taxBase: "0.00", ivaAmount: "0.00", adjustment: "-0.01" },
    ];
    deriveFinance(store, TODAY);
    const [inv] = store.invoices;

    expect(inv!.totals.ivaAmount).toBe("159.99");
    expect(inv!.status).toBe("PARCIAL");
    expect(inv!.hasPartialPayment).toBe(true);
    expect(inv!.allocations).toEqual([
      expect.objectContaining({
        payment: expect.objectContaining({ id: "pag_1" }),
        amountInvoiceCurrency: "400.00",
      }),
    ]);
  });

  it("marks an overdue invoice VENCIDA with its days overdue", () => {
    store.invoices[0]!.dueDate = "2026-10-03";
    deriveFinance(store, TODAY);
    expect(store.invoices[0]).toMatchObject({ status: "VENCIDA", daysOverdue: 10 });
  });

  it("leaves allocations of a voided payment out of the paid amount", () => {
    store.payments[0]!.status = "ANULADO";
    deriveFinance(store, TODAY);
    expect(store.invoices[0]!.totals.paidAmount).toBe("0.00");
    expect(store.invoices[0]!.status).toBe("EMITIDA");
  });

  it("derives the payment's allocatable, net credited and unallocated amounts", () => {
    deriveFinance(store, TODAY);
    expect(store.payments[0]).toMatchObject({
      allocatable: "485.00",
      netCredited: "498.00",
      allocated: "400.00",
      unallocated: "85.00",
    });
    expect(store.payments[0]!.allocations).toHaveLength(1);
  });

  it("derives installment status, invoiced amount and lock, and the plan's sum check", () => {
    deriveFinance(store, TODAY);
    expect(store.installments[0]).toMatchObject({
      status: "COBRADA_PARCIAL",
      invoicedAmount: "1000.00",
      locked: true,
    });
    expect(store.billingPlans[0]).toMatchObject({
      installmentsTotal: "1000.00",
      scheduleDifference: "-1500.00",
      scheduleConsistent: false,
    });
    expect(store.billingPlans[0]!.installments).toHaveLength(1);
  });

  it("derives the monthly amount of a recurring charge", () => {
    store.recurringCharges = [
      {
        id: "rc_1",
        projectId: "pry_web",
        label: "Hosting",
        amount: "300.00",
        currency: "USD",
        frequency: "TRIMESTRAL",
        startDate: "2026-01-05",
        endDate: null,
        billingDay: 5,
        leadDays: 7,
        status: "ACTIVO",
        lastGeneratedPeriodStart: null,
        monthlyAmount: "0.00",
        createdAt: STAMP,
        updatedAt: STAMP,
      } as RecurringChargeDTO,
    ];
    deriveFinance(store, TODAY);
    expect(store.recurringCharges[0]!.monthlyAmount).toBe("100.00");
  });

  it("derives the account balance from its confirmed payments (§9.7)", () => {
    deriveFinance(store, TODAY);
    expect(store.accounts[0]).toMatchObject({ balance: "1498.00", balanceUsd: "1498.00" });
  });

  it("runs on every build of the store", () => {
    const built = buildMockStore(new Date(`${TODAY}T15:00:00.000Z`));
    expect(built.invoices.every((inv) => inv.totals.total !== undefined)).toBe(true);
  });
});
