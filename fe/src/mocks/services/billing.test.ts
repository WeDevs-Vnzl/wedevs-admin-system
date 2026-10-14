// MOCK — tests for the billing services (PRD §8.4; HU-09 CA1–CA3, HU-10 CA1–CA3; D1 snapshot). Through the public
// service interface, on a fresh store built from the fixtures at FIXED_NOW (business day 2026-10-09).
import { describe, expect, it } from "vitest";
import { makeInvoice, makeLine, ref } from "../finance-test-factories";
import { createMockContext, ServiceError, type MockServiceContext } from "../ctx";
import { FIXED_NOW, FIXED_TODAY, makeTestContext } from "../test-helpers";
import { deriveMockStore } from "../store";
import {
  applyInstallmentTemplate,
  cancelInstallment,
  createInstallment,
  createRecurringCharge,
  generateMissingPeriods,
  getBillingPage,
  runRecurringGeneration,
  setRecurringChargeStatus,
  updateInstallment,
  upsertBillingPlan,
} from "./billing";

/** A project without fixture billing: the plans of the tests start from nothing. */
const PROJECT = "pry_solaris_portal";
const ARCHIVED_PROJECT = "pry_veredas_landing";

const planInput = (overrides: Record<string, unknown> = {}) =>
  ({
    projectId: PROJECT,
    model: "PRECIO_FIJO",
    currency: "USD",
    contractAmount: "10000",
    ...overrides,
  }) as Parameters<typeof upsertBillingPlan>[1];

// Service inputs are the parsed types of the validators: the optional fields are present as `undefined`.
const NO_OPTIONAL = {
  percentage: undefined,
  dueDate: undefined,
  trigger: undefined,
  endDate: undefined,
} as const;

const amountsOf = (page: { installments: { amount: string; cancelledAt: string | null }[] }) =>
  page.installments.filter((item) => item.cancelledAt === null).map((item) => item.amount);

function contextAt(h: ReturnType<typeof makeTestContext>, iso: string): MockServiceContext {
  return createMockContext({ user: h.user, now: new Date(iso), db: h.db });
}

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect((error as ServiceError).code).toBe(code);
  return error as ServiceError;
}

describe("billing plan and D1 snapshot (HU-09)", () => {
  it("a USD contract snapshots its amount in USD at rate 1", async () => {
    const h = makeTestContext("OWNER");
    const page = await upsertBillingPlan(h.ctx, planInput());
    expect(page.plan?.contractAmount).toBe("10000.00");
    expect(page.plan?.contractedUsd).toBe("10000.00");
    expect(page.plan?.usdRate).toBe("1");
  });

  it("a non-USD contract snapshots the rate of the day and never recomputes it (D1, C16)", async () => {
    const h = makeTestContext("OWNER");
    h.db.exchangeRates.push({
      id: "rat_test_eur",
      date: FIXED_TODAY,
      currency: "EUR",
      usdRate: "0.90",
      source: "BCV",
      createdAt: FIXED_NOW.toISOString(),
      createdById: null,
    });

    const saved = await upsertBillingPlan(
      h.ctx,
      planInput({ currency: "EUR", contractAmount: "1000" }),
    );
    expect(saved.plan?.contractedUsd).toBe("1111.11");
    expect(saved.plan?.usdRate).toBe("0.90");

    // The rate moves afterwards: a save that keeps the contract keeps the snapshot.
    const rate = h.db.exchangeRates.find((row) => row.id === "rat_test_eur");
    if (rate) rate.usdRate = "0.50";
    const resaved = await upsertBillingPlan(
      h.ctx,
      planInput({ currency: "EUR", contractAmount: "1000.00" }),
    );
    expect(resaved.plan?.contractedUsd).toBe("1111.11");
    expect(resaved.plan?.usdRate).toBe("0.90");

    await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "CUOTA",
      label: "Cuota de prueba",
      amount: "100",
      currency: "EUR",
    });
    const after = await getBillingPage(h.ctx, PROJECT);
    expect(after.plan?.contractedUsd).toBe("1111.11");

    // Changing the contract takes a new snapshot at the rate of the day.
    const changed = await upsertBillingPlan(
      h.ctx,
      planInput({ currency: "EUR", contractAmount: "2000" }),
    );
    expect(changed.plan?.usdRate).toBe("0.50");
    expect(changed.plan?.contractedUsd).toBe("4000.00");
  });

  it("a non-USD contract without a rate of the day is refused with the rate message", async () => {
    const h = makeTestContext("OWNER");
    h.db.exchangeRates = h.db.exchangeRates.filter((row) => row.currency !== "EUR");
    const error = await expectError(
      upsertBillingPlan(h.ctx, planInput({ currency: "EUR", contractAmount: "1000" })),
      "VALIDATION",
    );
    expect(error.fieldErrors?.currency).toEqual(["billing.errors.rateMissing"]);
  });

  it("an archived or unknown project is NOT_FOUND", async () => {
    const h = makeTestContext("OWNER");
    await expectError(
      upsertBillingPlan(h.ctx, planInput({ projectId: ARCHIVED_PROJECT })),
      "NOT_FOUND",
    );
    await expectError(
      upsertBillingPlan(h.ctx, planInput({ projectId: "pry_missing" })),
      "NOT_FOUND",
    );
  });
});

describe("quick template (HU-09 CA1)", () => {
  it("40/30/30 on 10 000 USD generates 4 000, 3 000 and 3 000", async () => {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput());
    const page = await applyInstallmentTemplate(h.ctx, {
      projectId: PROJECT,
      template: "SPLIT_40_30_30",
      replacePending: true,
    });
    expect(amountsOf(page)).toEqual(["4000.00", "3000.00", "3000.00"]);
    expect(page.installments.map((item) => item.percentage)).toEqual(["40", "30", "30"]);
    expect(page.installments.every((item) => item.currency === "USD")).toBe(true);
    expect(page.plan?.scheduleConsistent).toBe(true);
  });

  it("replacing the pending installments cancels the previous ones", async () => {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput());
    await applyInstallmentTemplate(h.ctx, {
      projectId: PROJECT,
      template: "SPLIT_50_50",
      replacePending: true,
    });
    const page = await applyInstallmentTemplate(h.ctx, {
      projectId: PROJECT,
      template: "THREE_EQUAL",
      replacePending: true,
    });
    // Percentages of 33.33 / 33.33 / 33.34 applied to 10 000: the last part absorbs the remainder.
    expect(amountsOf(page)).toEqual(["3333.00", "3333.00", "3334.00"]);
    expect(page.installments.filter((item) => item.cancelledAt !== null)).toHaveLength(2);
  });

  it("a template needs a contract amount", async () => {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput({ model: "RECURRENTE", contractAmount: undefined }));
    await expectError(
      applyInstallmentTemplate(h.ctx, {
        projectId: PROJECT,
        template: "SPLIT_50_50",
        replacePending: true,
      }),
      "VALIDATION",
    );
  });
});

describe("installment sum check (HU-09 CA2)", () => {
  it("installments that differ from the contract by more than 0.01 leave the warning on", async () => {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput());
    await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "ANTICIPO",
      label: "A",
      amount: "4000",
      currency: "USD",
    });
    const page = await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "HITO",
      label: "B",
      amount: "3000",
      currency: "USD",
    });
    expect(page.plan?.scheduleConsistent).toBe(false);
    expect(page.plan?.scheduleDifference).toBe("-3000.00");
  });

  it("a difference of exactly 0.01 is accepted, and AJUSTE installments are not counted", async () => {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput());
    await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "ANTICIPO",
      label: "A",
      amount: "4000",
      currency: "USD",
    });
    await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "FINAL",
      label: "B",
      amount: "5999.99",
      currency: "USD",
    });
    let page = await getBillingPage(h.ctx, PROJECT);
    expect(page.plan?.scheduleConsistent).toBe(true);

    page = await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "AJUSTE",
      label: "Ajuste de alcance",
      amount: "-500",
      currency: "USD",
    });
    expect(page.plan?.scheduleConsistent).toBe(true);
    expect(page.plan?.installmentsTotal).toBe("9999.99");
  });
});

describe("billed installments are locked (HU-09 CA3)", () => {
  async function billedInstallment() {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput());
    const page = await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "ANTICIPO",
      label: "Anticipo",
      amount: "4000",
      currency: "USD",
    });
    const installmentId = page.installments[0]!.id;
    h.db.invoices.push(
      makeInvoice({
        id: "inv_billed",
        status: "EMITIDA",
        lines: [
          makeLine({
            id: "inl_billed",
            unitPrice: "4000",
            ivaRate: "0",
            installment: ref(installmentId, "INSTALLMENT"),
          }),
        ],
      }),
    );
    deriveMockStore(h.db);
    return { h, installmentId };
  }

  it("a billed installment refuses any change other than its label", async () => {
    const { h, installmentId } = await billedInstallment();
    for (const change of [
      { amount: "4500" },
      { currency: "EUR" },
      { percentage: "45" },
      { dueDate: "2026-12-01" },
      { trigger: "Entrega final" },
    ]) {
      await expectError(
        updateInstallment(h.ctx, { ...NO_OPTIONAL, id: installmentId, ...change }),
        "INTEGRITY_LOCK",
      );
    }
    expect(h.db.installments.find((item) => item.id === installmentId)).toMatchObject({
      amount: "4000.00",
      currency: "USD",
    });
  });

  it("the label of a billed installment can still change", async () => {
    const { h, installmentId } = await billedInstallment();
    const page = await updateInstallment(h.ctx, {
      ...NO_OPTIONAL,
      id: installmentId,
      label: "Anticipo firmado",
    });
    expect(page.installments[0]?.label).toBe("Anticipo firmado");
    expect(page.installments[0]?.locked).toBe(true);
  });

  it("a voided invoice releases the lock", async () => {
    const { h, installmentId } = await billedInstallment();
    const invoice = h.db.invoices.find((item) => item.id === "inv_billed");
    if (invoice) invoice.voidedAt = FIXED_NOW.toISOString();
    deriveMockStore(h.db);
    const page = await updateInstallment(h.ctx, {
      ...NO_OPTIONAL,
      id: installmentId,
      amount: "4500",
    });
    expect(page.installments[0]?.amount).toBe("4500.00");
    expect(page.installments[0]?.locked).toBe(false);
  });

  it("a billed installment cannot be cancelled; a pending one can", async () => {
    const { h, installmentId } = await billedInstallment();
    await expectError(cancelInstallment(h.ctx, { id: installmentId }), "INTEGRITY_LOCK");
    const pending = await createInstallment(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      kind: "CUOTA",
      label: "Pendiente",
      amount: "100",
      currency: "USD",
    });
    const pendingId = pending.installments.find((item) => item.label === "Pendiente")!.id;
    const cancelled = await cancelInstallment(h.ctx, { id: pendingId });
    const row = cancelled.installments.find((item) => item.id === pendingId);
    expect(row?.status).toBe("CANCELADA");
    expect(row?.cancelledAt).not.toBeNull();
  });
});

describe("recurring charges (HU-10)", () => {
  /** Monthly charge billed on the 5th with 7 days of lead: the first period is 2026-11-05, generated on 2026-10-29. */
  async function monthlyCharge() {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput());
    const page = await createRecurringCharge(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      label: "Soporte",
      amount: "100",
      currency: "USD",
      frequency: "MENSUAL",
      startDate: "2026-11-01",
      billingDay: 5,
      leadDays: 7,
    });
    const chargeId = page.recurringCharges.find((item) => item.label === "Soporte")!.id;
    const generated = () => h.db.installments.filter((item) => item.recurringChargeId === chargeId);
    return { h, chargeId, generated };
  }

  it("the period is generated on the 29th of the previous month, with the 5th as its date", async () => {
    const { h, generated } = await monthlyCharge();
    await runRecurringGeneration(contextAt(h, "2026-10-28T15:00:00.000Z"));
    expect(generated()).toHaveLength(0);

    await runRecurringGeneration(contextAt(h, "2026-10-29T15:00:00.000Z"));
    expect(generated()).toHaveLength(1);
    expect(generated()[0]).toMatchObject({
      kind: "RECURRENTE",
      periodStart: "2026-11-05",
      dueDate: "2026-11-05",
      amount: "100.00",
      status: "PENDIENTE",
    });
  });

  it("running the job twice on the same day creates no duplicate", async () => {
    const { h, generated } = await monthlyCharge();
    const ctx = contextAt(h, "2026-10-29T15:00:00.000Z");
    await runRecurringGeneration(ctx);
    const second = await runRecurringGeneration(ctx);
    expect(generated()).toHaveLength(1);
    expect(second.periodStarts).not.toContain("2026-11-05");
  });

  it("a paused charge generates nothing; on request it creates the missing periods", async () => {
    const { h, chargeId, generated } = await monthlyCharge();
    await setRecurringChargeStatus(h.ctx, { id: chargeId, status: "PAUSADO" });
    await runRecurringGeneration(contextAt(h, "2026-12-31T15:00:00.000Z"));
    expect(generated()).toHaveLength(0);

    const result = await generateMissingPeriods(h.ctx, {
      recurringChargeId: chargeId,
      upTo: "2026-12-31",
    });
    expect(result.periodStarts).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
    expect(generated()).toHaveLength(3);
  });

  it("a finished charge is final", async () => {
    const { h, chargeId } = await monthlyCharge();
    await setRecurringChargeStatus(h.ctx, { id: chargeId, status: "FINALIZADO" });
    await expectError(
      setRecurringChargeStatus(h.ctx, { id: chargeId, status: "ACTIVO" }),
      "CONFLICT",
    );
  });

  it("the monthly equivalent of a quarterly charge is a third of it (C17)", async () => {
    const h = makeTestContext("OWNER");
    await upsertBillingPlan(h.ctx, planInput());
    const page = await createRecurringCharge(h.ctx, {
      ...NO_OPTIONAL,
      projectId: PROJECT,
      label: "Trimestral",
      amount: "300",
      currency: "USD",
      frequency: "TRIMESTRAL",
      startDate: "2026-11-01",
      billingDay: 5,
      leadDays: 7,
    });
    expect(page.recurringCharges[0]?.monthlyAmount).toBe("100.00");
  });
});

describe("fixtures", () => {
  it("kairos web is a fixed price of 10 000 USD split 40/30/30, with its snapshot", async () => {
    const h = makeTestContext("OWNER");
    const page = await getBillingPage(h.ctx, "pry_kairos_web");
    expect(amountsOf(page)).toEqual(["4000.00", "3000.00", "3000.00"]);
    expect(page.plan?.contractedUsd).toBe("10000.00");
    expect(page.plan?.scheduleConsistent).toBe(true);
  });

  it("the maintenance project has a recurring plan and its monthly charge", async () => {
    const h = makeTestContext("OWNER");
    const page = await getBillingPage(h.ctx, "pry_kairos_mantenimiento");
    expect(page.plan?.model).toBe("RECURRENTE");
    expect(page.recurringCharges).toHaveLength(1);
    expect(page.recurringCharges[0]?.status).toBe("ACTIVO");
  });

  it("an archived project has no billing page", async () => {
    const h = makeTestContext("OWNER");
    await expectError(getBillingPage(h.ctx, ARCHIVED_PROJECT), "NOT_FOUND");
  });
});
