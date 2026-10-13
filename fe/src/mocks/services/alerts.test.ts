// MOCK — tests for the alert rules and the dismiss/snooze/restore services (PRD §7.9).
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import type { AlertType, AlertsService } from "@/lib/validators/alerts";
import type { InstallmentDTO } from "@/lib/validators/billing";
import type { ExpenseDetailDTO } from "@/lib/validators/expenses";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import type { PaymentDetailDTO } from "@/lib/validators/payments";
import type { MockServiceContext } from "../ctx";
import { FIXED_NOW, FIXED_TODAY, makeTestContext } from "../test-helpers";
import * as alertsService from "./alerts";
import { dismissAlert, listAlerts, restoreAlert, snoozeAlert } from "./alerts";

type Harness = ReturnType<typeof makeTestContext>;

const partial = <T>(value: Record<string, unknown>) => value as unknown as T;

function invoice(id: string, dueOffset: number, over: Record<string, unknown> = {}) {
  return partial<InvoiceDetailDTO>({
    id,
    code: id,
    isDraft: false,
    status: "EMITIDA",
    dueDate: addDays(FIXED_TODAY, dueOffset),
    currency: "USD",
    client: { type: "CLIENT", id: "cli_x", label: "Cliente Prueba", code: null },
    totals: { balance: "100.00" },
    ...over,
  });
}

function payment(id: string, ageDays: number, over: Record<string, unknown> = {}) {
  return partial<PaymentDetailDTO>({
    id,
    code: id,
    date: addDays(FIXED_TODAY, -ageDays),
    status: "CONFIRMADO",
    currency: "USD",
    amount: "500.00",
    unallocated: "50.00",
    client: { type: "CLIENT", id: "cli_x", label: "Cliente Prueba", code: null },
    ...over,
  });
}

const types = async (h: Harness, only?: AlertType[]) =>
  (await listAlerts(h.ctx, { types: only, limit: 50 })).items.map((i) => i.type);

/** Only the rule under test: finance and rate collections emptied, documents kept out by type filter. */
function only(h: Harness, type: AlertType) {
  return listAlerts(h.ctx, { types: [type], limit: 50 });
}

describe("listAlerts rules", () => {
  it("fixtures: the expiring NDA and the expired proposal alert, the rate exists", async () => {
    const h = makeTestContext("OWNER");
    const list = await types(h);
    expect(list).toContain("DOCUMENT_EXPIRING");
    expect(list).toContain("DOCUMENT_EXPIRED");
    expect(list).not.toContain("MISSING_RATE");
  });

  it("invoice overdue: VENCIDA only, never drafts", async () => {
    const h = makeTestContext("OWNER");
    h.db.invoices.push(
      invoice("inv_a", -10, { status: "VENCIDA" }),
      invoice("inv_b", -10, { status: "VENCIDA", isDraft: true }),
    );
    const r = await only(h, "INVOICE_OVERDUE");
    expect(r.items.map((i) => i.alertKey)).toEqual(["INVOICE_OVERDUE:inv_a"]);
    expect(r.items[0]).toMatchObject({ days: -10, amount: { amount: "100.00", currency: "USD" } });
  });

  it("invoice due soon: day 7 yes, day 8 no, balance 0.00 no, 0.01 yes", async () => {
    const h = makeTestContext("OWNER");
    h.db.invoices.push(
      invoice("inv_7", 7),
      invoice("inv_8", 8),
      invoice("inv_zero", 3, { totals: { balance: "0.00" } }),
      invoice("inv_cent", 3, { totals: { balance: "0.01" } }),
      invoice("inv_paid", 3, { status: "PAGADA" }),
    );
    const r = await only(h, "INVOICE_DUE_SOON");
    expect(r.items.map((i) => i.alertKey).sort()).toEqual([
      "INVOICE_DUE_SOON:inv_7",
      "INVOICE_DUE_SOON:inv_cent",
    ]);
  });

  it("installment: PENDIENTE due in 7 days or past; day 8 and billed ones are out", async () => {
    const h = makeTestContext("OWNER");
    const inst = (id: string, off: number | null, status = "PENDIENTE") =>
      partial<InstallmentDTO>({
        id,
        projectId: h.db.projects[0]!.id,
        label: id,
        amount: "300.00",
        currency: "USD",
        dueDate: off === null ? null : addDays(FIXED_TODAY, off),
        status,
      });
    h.db.installments.push(
      inst("i7", 7),
      inst("i8", 8),
      inst("ipast", -4),
      inst("inull", null),
      inst("ibilled", 1, "FACTURADA"),
    );
    const r = await only(h, "INSTALLMENT_TO_INVOICE");
    expect(r.items.map((i) => i.alertKey).sort()).toEqual([
      "INSTALLMENT_TO_INVOICE:i7",
      "INSTALLMENT_TO_INVOICE:ipast",
    ]);
    expect(r.items[0]?.entity?.type).toBe("PROJECT");
  });

  it("document expiring: inside alertDaysBefore (default 30) inclusive, 31 days out", async () => {
    const h = makeTestContext("OWNER");
    const [doc] = h.db.documents.filter((d) => d.expiresAt && d.status !== "VENCIDO");
    expect(doc).toBeDefined();
    doc!.alertDaysBefore = 30;
    doc!.expiresAt = addDays(FIXED_TODAY, 30);
    expect((await only(h, "DOCUMENT_EXPIRING")).items.some((i) => i.entity?.id === doc!.id)).toBe(true);
    doc!.expiresAt = addDays(FIXED_TODAY, 31);
    expect((await only(h, "DOCUMENT_EXPIRING")).items.some((i) => i.entity?.id === doc!.id)).toBe(false);
    doc!.alertDaysBefore = 45;
    expect((await only(h, "DOCUMENT_EXPIRING")).items.some((i) => i.entity?.id === doc!.id)).toBe(true);
  });

  it("document expired: status VENCIDO, archived ones left out", async () => {
    const h = makeTestContext("OWNER");
    const before = (await only(h, "DOCUMENT_EXPIRED")).total;
    expect(before).toBeGreaterThan(0);
    for (const d of h.db.documents) if (d.status === "VENCIDO") d.archivedAt = "2026-10-01T00:00:00.000Z";
    expect((await only(h, "DOCUMENT_EXPIRED")).total).toBe(0);
  });

  it("recurring expense: generated PENDIENTE due in 5 days or past; day 6 and manual ones out", async () => {
    const h = makeTestContext("OWNER");
    const exp = (id: string, off: number, over: Record<string, unknown> = {}) =>
      partial<ExpenseDetailDTO>({
        id,
        description: id,
        vendor: null,
        amount: "80.00",
        currency: "USD",
        recurring: true,
        status: "PENDIENTE",
        dueDate: addDays(FIXED_TODAY, off),
        ...over,
      });
    h.db.expenses.push(
      exp("e5", 5),
      exp("e6", 6),
      exp("epast", -2),
      exp("emanual", 1, { recurring: false }),
      exp("epaid", 1, { status: "PAGADO" }),
    );
    const r = await only(h, "RECURRING_EXPENSE_PENDING");
    expect(r.items.map((i) => i.alertKey).sort()).toEqual([
      "RECURRING_EXPENSE_PENDING:e5",
      "RECURRING_EXPENSE_PENDING:epast",
    ]);
  });

  it("payment to verify: 3 days old yes, 2 days no", async () => {
    const h = makeTestContext("OWNER");
    h.db.payments.push(
      payment("p2", 2, { status: "PENDIENTE_VERIFICACION" }),
      payment("p3", 3, { status: "PENDIENTE_VERIFICACION" }),
    );
    const r = await only(h, "PAYMENT_PENDING_VERIFICATION");
    expect(r.items.map((i) => i.alertKey)).toEqual(["PAYMENT_PENDING_VERIFICATION:p3"]);
    expect(r.items[0]?.days).toBe(-3);
  });

  it("unallocated credit: 16 days yes, 15 no, balance 0.00 no, 0.01 yes", async () => {
    const h = makeTestContext("OWNER");
    h.db.payments.push(
      payment("u15", 15),
      payment("u16", 16),
      payment("uzero", 20, { unallocated: "0.00" }),
      payment("ucent", 20, { unallocated: "0.01" }),
      payment("upend", 20, { status: "PENDIENTE_VERIFICACION" }),
    );
    const r = await only(h, "UNALLOCATED_CREDIT");
    expect(r.items.map((i) => i.alertKey).sort()).toEqual([
      "UNALLOCATED_CREDIT:u16",
      "UNALLOCATED_CREDIT:ucent",
    ]);
    expect(r.items.find((i) => i.entity?.id === "u16")?.amount).toEqual({
      amount: "50.00",
      currency: "USD",
    });
  });

  it("missing rate: business day without a VES rate alerts, with a rate or on a weekend it does not", async () => {
    const h = makeTestContext("OWNER");
    expect((await only(h, "MISSING_RATE")).total).toBe(0);
    h.db.exchangeRates = h.db.exchangeRates.filter((r) => r.date !== FIXED_TODAY);
    const r = await only(h, "MISSING_RATE");
    expect(r.items).toMatchObject([
      { alertKey: `MISSING_RATE:VES:${FIXED_TODAY}`, entity: null, date: FIXED_TODAY },
    ]);
    const saturday = { ...h.ctx, now: new Date("2026-10-10T15:00:00.000Z") };
    expect((await listAlerts(saturday, { types: ["MISSING_RATE"], limit: 5 })).total).toBe(0);
  });
});

describe("listAlerts filtering", () => {
  it("total is not capped by limit; byType counts", async () => {
    const h = makeTestContext("OWNER");
    h.db.invoices.push(invoice("a", -1, { status: "VENCIDA" }), invoice("b", -2, { status: "VENCIDA" }));
    const all = await listAlerts(h.ctx, { limit: 50 });
    const capped = await listAlerts(h.ctx, { limit: 1 });
    expect(capped.total).toBe(all.total);
    expect(capped.items).toHaveLength(1);
    expect(all.byType.INVOICE_OVERDUE).toBe(2);
    const overdue = all.items.filter((i) => i.type === "INVOICE_OVERDUE");
    expect(overdue.map((i) => i.alertKey)).toEqual(["INVOICE_OVERDUE:b", "INVOICE_OVERDUE:a"]); // most overdue first
  });

  it("filters types by role: Member keeps documents, Viewer too, no finance or rate", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const h = makeTestContext(role);
      h.db.invoices.push(invoice("a", -1, { status: "VENCIDA" }));
      h.db.exchangeRates = [];
      const list = await types(h);
      expect(list).toContain("DOCUMENT_EXPIRING");
      expect(list).not.toContain("INVOICE_OVERDUE");
      expect(list).not.toContain("MISSING_RATE");
    }
    const admin = makeTestContext("ADMIN");
    admin.db.exchangeRates = [];
    expect(await types(admin)).toContain("MISSING_RATE");
  });
});

describe("dismiss, snooze, restore", () => {
  const key = "INVOICE_OVERDUE:a";
  const setup = () => {
    const h = makeTestContext("OWNER");
    h.db.invoices.push(invoice("a", -1, { status: "VENCIDA" }));
    return h;
  };

  it("dismiss hides for good and is per user", async () => {
    const h = setup();
    expect(await dismissAlert(h.ctx, { alertKey: key })).toEqual({
      alertKey: key,
      dismissedUntil: null,
      active: false,
    });
    expect(await types(h, ["INVOICE_OVERDUE"])).toEqual([]);
    const other = { ...h.ctx, user: { ...h.user, id: "usr_other" } };
    expect((await listAlerts(other, { types: ["INVOICE_OVERDUE"], limit: 5 })).total).toBe(1);
  });

  it("snooze hides until now + days, then the alert returns", async () => {
    const h = setup();
    const r = await snoozeAlert(h.ctx, { alertKey: key, days: 3 });
    expect(r.dismissedUntil).toBe(new Date(FIXED_NOW.getTime() + 3 * 86_400_000).toISOString());
    expect(await types(h, ["INVOICE_OVERDUE"])).toEqual([]);
    const later = { ...h.ctx, now: new Date(FIXED_NOW.getTime() + 3 * 86_400_000 + 1) };
    expect((await listAlerts(later, { types: ["INVOICE_OVERDUE"], limit: 5 })).total).toBe(1);
  });

  it("snoozing again replaces the row; dismiss then snooze keeps one row", async () => {
    const h = setup();
    await dismissAlert(h.ctx, { alertKey: key });
    await snoozeAlert(h.ctx, { alertKey: key, days: 1 });
    expect(h.db.alertDismissals).toHaveLength(1);
    expect(h.db.alertDismissals[0]?.dismissedUntil).not.toBeNull();
  });

  it("restore brings it back and only touches the caller's rows", async () => {
    const h = setup();
    await dismissAlert(h.ctx, { alertKey: key });
    const other = { ...h.ctx, user: { ...h.user, id: "usr_other" } };
    await dismissAlert(other, { alertKey: key });
    expect(await restoreAlert(h.ctx, { alertKey: key })).toEqual({
      alertKey: key,
      dismissedUntil: null,
      active: true,
    });
    expect(await types(h, ["INVOICE_OVERDUE"])).toEqual(["INVOICE_OVERDUE"]);
    expect(h.db.alertDismissals).toMatchObject([{ userId: "usr_other" }]);
  });
});

describe("type contract (F12)", () => {
  it("satisfies AlertsService over the mock context", () => {
    const service = alertsService satisfies AlertsService<MockServiceContext>;
    expect(typeof service.listAlerts).toBe("function");
  });
});
