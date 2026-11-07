import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  applyInstallmentTemplateAction,
  cancelInstallmentAction,
  createInstallmentAction,
  createRecurringChargeAction,
  generateMissingPeriodsAction,
  setRecurringChargeStatusAction,
  updateInstallmentAction,
  updateRecurringChargeAction,
  upsertBillingPlanAction,
} from "./actions";

const installment = (order: number, amount: string, percentage: string) => ({
  id: `ins_${order}`,
  projectId: "prj_1",
  billingPlanId: "bpl_1",
  recurringChargeId: null,
  kind: "CUOTA",
  label: `Cuota ${order + 1}`,
  amount,
  currency: "USD",
  percentage,
  dueDate: null,
  trigger: null,
  periodStart: null,
  periodEnd: null,
  order,
  status: "PENDIENTE",
  cancelledAt: null,
  invoicedAmount: "0.00",
  locked: false,
});

const page = {
  projectId: "prj_1",
  plan: null,
  installments: [
    installment(0, "4000.00", "40"),
    installment(1, "3000.00", "30"),
    installment(2, "3000.00", "30"),
  ],
  recurringCharges: [],
};

function use(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked.calls;
}

beforeEach(() => {
  cache.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("upsertBillingPlanAction", () => {
  it("saves the plan through PUT /projects/{id}/billing-plan without the project id in the body", async () => {
    const calls = use({ "PUT /api/v1/projects/{id}/billing-plan": { body: page } });

    const result = await upsertBillingPlanAction({
      projectId: "prj_1",
      model: "PRECIO_FIJO",
      currency: "USD",
      contractAmount: "10000.00",
    });

    expect(result).toEqual({ ok: true, data: page });
    expect(calls[0]?.path).toBe("/api/v1/projects/prj_1/billing-plan");
    expect(calls[0]?.body).toEqual({
      model: "PRECIO_FIJO",
      currency: "USD",
      contractAmount: "10000.00",
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects", "layout");
  });

  it("shows billing.errors.rateMissing on the currency field and revalidates nothing", async () => {
    use({
      "PUT /api/v1/projects/{id}/billing-plan": errorEnvelope("VALIDATION", {
        message: "billing.errors.rateMissing",
        fieldErrors: { currency: ["billing.errors.rateMissing"] },
      }),
    });

    const result = await upsertBillingPlanAction({
      projectId: "prj_1",
      model: "PRECIO_FIJO",
      currency: "EUR",
      contractAmount: "10000.00",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "VALIDATION",
        fieldErrors: { currency: ["billing.errors.rateMissing"] },
      }),
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("answers FORBIDDEN for a Member", async () => {
    use({ "PUT /api/v1/projects/{id}/billing-plan": errorEnvelope("FORBIDDEN") });

    const result = await upsertBillingPlanAction({
      projectId: "prj_1",
      model: "RECURRENTE",
      currency: "USD",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("applyInstallmentTemplateAction", () => {
  it("sends only the template: the 40/30/30 amounts of 10,000 come from the response (HU-09 CA1)", async () => {
    const calls = use({ "POST /api/v1/projects/{id}/billing-plan/template": { body: page } });

    const result = await applyInstallmentTemplateAction({
      projectId: "prj_1",
      template: "SPLIT_40_30_30",
      replacePending: true,
    });

    expect(calls[0]?.path).toBe("/api/v1/projects/prj_1/billing-plan/template");
    expect(calls[0]?.body).toEqual({ template: "SPLIT_40_30_30", replacePending: true });
    expect(result.ok && result.data.installments.map((item) => item.amount)).toEqual([
      "4000.00",
      "3000.00",
      "3000.00",
    ]);
  });
});

describe("installments", () => {
  it("creates one through POST /projects/{id}/installments", async () => {
    const calls = use({ "POST /api/v1/projects/{id}/installments": { status: 201, body: page } });

    await createInstallmentAction({
      projectId: "prj_1",
      kind: "HITO",
      label: "Hito",
      amount: "100.00",
      currency: "USD",
    });

    expect(calls[0]?.path).toBe("/api/v1/projects/prj_1/installments");
    expect(calls[0]?.body).toEqual({
      kind: "HITO",
      label: "Hito",
      amount: "100.00",
      currency: "USD",
    });
  });

  it("updates one through PATCH /installments/{id}", async () => {
    const calls = use({ "PATCH /api/v1/installments/{id}": { body: page } });

    await updateInstallmentAction({ id: "ins_0", label: "Renombrada" });

    expect(calls[0]?.path).toBe("/api/v1/installments/ins_0");
    expect(calls[0]?.body).toEqual({ label: "Renombrada" });
  });

  it("cancels one through POST /installments/{id}/cancel", async () => {
    const calls = use({ "POST /api/v1/installments/{id}/cancel": { body: page } });

    expect(await cancelInstallmentAction({ id: "ins_0" })).toMatchObject({ ok: true });
    expect(calls[0]?.path).toBe("/api/v1/installments/ins_0/cancel");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("maps a billed installment to INTEGRITY_LOCK", async () => {
    use({ "POST /api/v1/installments/{id}/cancel": errorEnvelope("INTEGRITY_LOCK") });

    expect(await cancelInstallmentAction({ id: "ins_0" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK" },
    });
  });
});

const charge = {
  label: "Hosting",
  amount: "50.00",
  currency: "USD",
  frequency: "MENSUAL" as const,
  startDate: "2026-01-01",
  billingDay: 5,
  leadDays: 7,
  endDate: undefined,
};

describe("recurring charges", () => {
  it("creates one through POST /projects/{id}/recurring-charges", async () => {
    const calls = use({
      "POST /api/v1/projects/{id}/recurring-charges": { status: 201, body: page },
    });

    await createRecurringChargeAction({ projectId: "prj_1", ...charge });

    expect(calls[0]?.path).toBe("/api/v1/projects/prj_1/recurring-charges");
    expect(calls[0]?.body).toMatchObject({ label: "Hosting", amount: "50.00" });
    expect(calls[0]?.body).not.toHaveProperty("projectId");
  });

  it("updates one through PATCH /recurring-charges/{id}", async () => {
    const calls = use({ "PATCH /api/v1/recurring-charges/{id}": { body: page } });

    await updateRecurringChargeAction({ id: "rch_1", ...charge });

    expect(calls[0]?.path).toBe("/api/v1/recurring-charges/rch_1");
    expect(calls[0]?.body).not.toHaveProperty("id");
  });

  it("pauses and resumes through POST /recurring-charges/{id}/status", async () => {
    const calls = use({ "POST /api/v1/recurring-charges/{id}/status": { body: page } });

    await setRecurringChargeStatusAction({ id: "rch_1", status: "PAUSADO" });
    await setRecurringChargeStatusAction({ id: "rch_1", status: "ACTIVO" });

    expect(calls.map((call) => call.body)).toEqual([{ status: "PAUSADO" }, { status: "ACTIVO" }]);
    expect(calls[0]?.path).toBe("/api/v1/recurring-charges/rch_1/status");
  });

  it("generates the missing periods and lists the ones the BE returns", async () => {
    const calls = use({
      "POST /api/v1/recurring-charges/{id}/generate-missing-periods": {
        body: { created: 2, periodStarts: ["2026-02-05", "2026-03-05"] },
      },
    });

    const result = await generateMissingPeriodsAction({ recurringChargeId: "rch_1" });

    expect(calls[0]?.path).toBe("/api/v1/recurring-charges/rch_1/generate-missing-periods");
    expect(calls[0]?.body).toEqual({});
    expect(result).toEqual({
      ok: true,
      data: { created: 2, periodStarts: ["2026-02-05", "2026-03-05"] },
    });
  });
});
