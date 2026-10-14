// T10 phase B regression tests (odd/tasks/h1-b3-finance-ui.md): S14 carried items, D1 snapshot and S11 HU-17 CA3
// through the mock services.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectRate } from "@/lib/rates";
import { toUsd } from "@/lib/money";
import { createInvoiceInputSchema, updateInvoiceInputSchema } from "@/lib/validators/invoices";
import { createPaymentInputSchema } from "@/lib/validators/payments";
import { createExpenseInputSchema, markExpensePaidInputSchema } from "@/lib/validators/expenses";
import {
  createInstallmentInputSchema,
  upsertBillingPlanInputSchema,
} from "@/lib/validators/billing";
import { createMockContext } from "@/mocks/ctx";
import { mockId } from "@/mocks/ids";
import { deriveMockStore } from "@/mocks/store";
import { FIXED_NOW, makeTestContext } from "@/mocks/test-helpers";
import { createInstallment, getBillingPage, upsertBillingPlan } from "@/mocks/services/billing";
import { archiveInvoice, createInvoice, updateInvoice } from "@/mocks/services/invoices";
import { createPayment } from "@/mocks/services/payments";
import { createExpense, markExpensePaid } from "@/mocks/services/expenses";
import { getProjectFinancials, listProjects } from "@/mocks/services/projects";
import { projectFilterSchema } from "@/lib/validators/projects";
import { listAlerts } from "@/mocks/services/alerts";

const SOLARIS = mockId("pry", "solaris_portal");
const SOLARIS_CLIENT = mockId("cli", "solaris_energia");
const MAINTENANCE = mockId("pry", "kairos_mantenimiento");
const HOSTING = mockId("ecat", "hosting");

let ctx: ReturnType<typeof makeTestContext>["ctx"];
let db: ReturnType<typeof makeTestContext>["db"];
let user: ReturnType<typeof makeTestContext>["user"];
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

const plan = (o: Record<string, unknown>) =>
  upsertBillingPlanInputSchema.parse({ projectId: SOLARIS, model: "PRECIO_FIJO", ...o });

describe("D1 contract snapshot", () => {
  it("is taken at plan save and never recomputed when rates change", async () => {
    const page = await upsertBillingPlan(
      ctx,
      plan({ currency: "VES", contractAmount: "755160.00" }),
    );
    const rate = selectRate(db.exchangeRates, "2026-10-09", "VES");
    expect(rate).toBeTruthy();
    expect(page.plan!.usdRate).toBe(rate!.usdRate);
    expect(page.plan!.contractedUsd).toBe(toUsd("755160.00", rate!.usdRate));
    const snapshot = { contractedUsd: page.plan!.contractedUsd, usdRate: page.plan!.usdRate };

    // Every VES rate changes, the store is derived again, days pass, the plan is saved again with the same
    // contract (other fields changed): the snapshot stays.
    for (const row of db.exchangeRates) if (row.currency === "VES") row.usdRate = "1500.0000";
    deriveMockStore(db);
    const later = at("2026-10-20T15:00:00.000Z");
    const again = await upsertBillingPlan(
      later,
      plan({ model: "MIXTO", currency: "VES", contractAmount: "755160", notes: "x" }),
    );
    expect({ contractedUsd: again.plan!.contractedUsd, usdRate: again.plan!.usdRate }).toEqual(
      snapshot,
    );
    expect((await getBillingPage(later, SOLARIS)).plan).toMatchObject(snapshot);
    const summary = await getProjectFinancials(later, { id: SOLARIS });
    expect(summary.contractedValue).toBe(snapshot.contractedUsd);
  });
});

describe("S14 projectHeadline / summary per PRD §8.4.4 + S11 HU-17 CA3", () => {
  const pay = (o: Record<string, unknown>) =>
    createPaymentInputSchema.parse({
      clientId: SOLARIS_CLIENT,
      date: "2026-10-09",
      accountId: "acc_zelle",
      methodId: "pmt_zelle",
      currency: "USD",
      igtfAmount: "0.00",
      feeAmount: "0.00",
      usdRate: "1",
      reference: "PRB-S14",
      ...o,
    });

  it("contracted + adjustments, proportional collected, toInvoice, expenses → margin", async () => {
    await upsertBillingPlan(ctx, plan({ currency: "USD", contractAmount: "10000.00" }));
    await createInstallment(
      ctx,
      createInstallmentInputSchema.parse({
        projectId: SOLARIS,
        kind: "AJUSTE",
        label: "Adenda",
        amount: "500.00",
        currency: "USD",
      }),
    );
    const invoice = await createInvoice(
      ctx,
      createInvoiceInputSchema.parse({
        clientId: SOLARIS_CLIENT,
        invoiceNumber: "S14-1",
        issueDate: "2026-10-09",
        dueDate: "2026-11-08",
        currency: "USD",
        usdRate: "1",
        lines: [
          { description: "project", projectId: SOLARIS, unitPrice: "1000.00", ivaRate: null },
          { description: "other", unitPrice: "1000.00", ivaRate: null },
        ],
      }),
    );
    expect(invoice.totals.receivable).toBe("2000.00");
    await createPayment(
      ctx,
      pay({
        amount: "1000.00",
        allocations: [
          {
            invoiceId: invoice.id,
            amountPaymentCurrency: "1000.00",
            amountInvoiceCurrency: "1000.00",
          },
        ],
      }),
    );
    let s = await getProjectFinancials(ctx, { id: SOLARIS });
    expect(s).toMatchObject({
      contractedValue: "10500.00",
      invoiced: "1000.00",
      collected: "500.00", // half of the invoice is paid → half of the project line
      toInvoice: "9500.00",
      receivable: "500.00",
      allocatedExpenses: "0.00",
      margin: "500.00",
    });
    const row = (await listProjects(ctx, projectFilterSchema.parse({ q: "Solaris" }))).items.find(
      (item) => item.id === SOLARIS,
    )!;
    expect(row).toMatchObject({
      contractedValueUsd: "10500.00",
      invoicedUsd: "1000.00",
      collectedUsd: "500.00",
      toInvoiceUsd: "9500.00",
    });

    // S11 HU-17 CA3: a pending expense does not count; once paid it reduces the project margin.
    const pending = await createExpense(
      ctx,
      createExpenseInputSchema.parse({
        date: "2026-10-09",
        description: "Hosting Solaris",
        categoryId: HOSTING,
        projectId: SOLARIS,
        currency: "USD",
        amount: "120.00",
        usdRate: "1",
        status: "PENDIENTE",
      }),
    );
    expect((await getProjectFinancials(ctx, { id: SOLARIS })).margin).toBe("500.00");
    await markExpensePaid(
      ctx,
      markExpensePaidInputSchema.parse({
        id: pending.id,
        accountId: "acc_zelle",
        paidAt: "2026-10-09",
        currency: "USD",
        amount: "150.00",
        usdRate: "1",
      }),
    );
    s = await getProjectFinancials(ctx, { id: SOLARIS });
    expect(s).toMatchObject({
      allocatedExpenses: "150.00",
      margin: "350.00",
      marginPercent: "70.00",
    });
    await createExpense(
      ctx,
      createExpenseInputSchema.parse({
        date: "2026-10-09",
        description: "Freelance",
        categoryId: HOSTING,
        projectId: SOLARIS,
        accountId: "acc_zelle",
        currency: "USD",
        amount: "50.00",
        usdRate: "1",
      }),
    );
    expect((await getProjectFinancials(ctx, { id: SOLARIS })).margin).toBe("300.00");
  });

  it("toInvoice only for PRECIO_FIJO / MIXTO (RECURRENTE → null, headline 0.00)", async () => {
    const s = await getProjectFinancials(ctx, { id: MAINTENANCE });
    expect(s.toInvoice).toBeNull();
    const row = (
      await listProjects(ctx, projectFilterSchema.parse({ q: "Mantenimiento" }))
    ).items.find((item) => item.id === MAINTENANCE)!;
    expect(row.toInvoiceUsd).toBe("0.00");
  });
});

describe("S14 alerts skip archived invoices; HU-29 CA1 total diff", () => {
  it("an overdue invoice stops alerting once archived", async () => {
    const overdue = await createInvoice(
      ctx,
      createInvoiceInputSchema.parse({
        clientId: SOLARIS_CLIENT,
        invoiceNumber: "S14-OVD",
        issueDate: "2026-08-01",
        dueDate: "2026-08-16",
        currency: "USD",
        usdRate: "1",
        lines: [{ description: "x", unitPrice: "10.00", ivaRate: null }],
      }),
    );
    expect(overdue.status).toBe("VENCIDA");
    const keyed = async () =>
      (await listAlerts(ctx, { limit: 500 })).items.filter((a) => a.entity?.id === overdue.id);
    expect((await keyed()).map((a) => a.type)).toContain("INVOICE_OVERDUE");
    await archiveInvoice(ctx, { id: overdue.id });
    expect(await keyed()).toEqual([]);
  });

  it("an invoice edit logs total: [before, after]", async () => {
    const created = await createInvoice(
      ctx,
      createInvoiceInputSchema.parse({
        clientId: SOLARIS_CLIENT,
        invoiceNumber: "S14-UPD",
        issueDate: "2026-10-09",
        dueDate: "2026-11-08",
        currency: "USD",
        usdRate: "1",
        lines: [{ description: "x", unitPrice: "100.00", ivaRate: "16" }],
      }),
    );
    await updateInvoice(
      ctx,
      updateInvoiceInputSchema.parse({
        id: created.id,
        clientId: SOLARIS_CLIENT,
        invoiceNumber: "S14-UPD",
        issueDate: "2026-10-09",
        dueDate: "2026-11-08",
        currency: "USD",
        usdRate: "1",
        lines: [{ description: "x", unitPrice: "200.00", ivaRate: "16" }],
      }),
    );
    const entry = db.activity.findLast(
      (item) => item.entityId === created.id && item.action === "UPDATE",
    );
    expect(JSON.stringify(entry?.changes)).toContain("116.00");
    expect(JSON.stringify(entry?.changes)).toContain("232.00");
  });
});
