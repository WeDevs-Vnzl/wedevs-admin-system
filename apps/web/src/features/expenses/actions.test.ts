import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import { listQuerySchema } from "@/lib/validators/common";
import {
  createExpenseAction,
  createRecurringExpenseAction,
  listExpensesAction,
  markExpensePaidAction,
  searchExpensesAction,
  setRecurringExpenseStatusAction,
  updateExpenseAction,
  voidExpenseAction,
} from "./actions";
import { expenseFilterOf } from "./components/expense-table-query";
import { makeExpense, makeRecurringExpense, page } from "./test-fixtures";

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  mocks.getServerApi.mockReset();
  mocks.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listExpensesAction", () => {
  it("sends the facets, the search and the sort of the table query as flat keys", async () => {
    const { calls } = useRoutes({ "GET /api/v1/expenses": { body: page([makeExpense()]) } });
    const result = await listExpensesAction(
      expenseFilterOf(
        listQuerySchema.parse({
          sort: "amountUsd:desc",
          q: "kairos",
          filters: { status: ["PAGADO"], currency: ["VES"], date: ["2026-10-01", "2026-10-31"] },
        }),
      ),
    );
    expect(result).toMatchObject({ ok: true, data: { total: 1 } });
    const search = calls[0]?.search;
    expect(search?.get("sort")).toBe("amountUsd:desc");
    expect(search?.get("q")).toBe("kairos");
    expect(search?.getAll("status")).toEqual(["PAGADO"]);
    expect(search?.get("dateFrom")).toBe("2026-10-01");
    expect(search?.get("dateTo")).toBe("2026-10-31");
  });

  it("rejects a sort outside the whitelist with VALIDATION before any call", async () => {
    const { calls } = useRoutes({});
    expect(await listExpensesAction({ sort: "category:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });

  it("returns FORBIDDEN for a role the BE refuses (Member, Viewer)", async () => {
    useRoutes({ "GET /api/v1/expenses": errorEnvelope("FORBIDDEN") });
    expect(await listExpensesAction({})).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("createExpenseAction (HU-17 CA1)", () => {
  it("posts a one-off expense charged to a project and refreshes the expense layouts", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/expenses": { status: 201, body: makeExpense({ project: null }) },
    });
    const result = await createExpenseAction({
      date: "2026-10-05",
      description: "Hosting de producción (MOCK)",
      categoryId: "cat_hosting",
      projectId: "pry_kairos_web",
      currency: "USD",
      amount: "120.00",
      usdRate: "1",
      status: "PENDIENTE",
    });
    expect(result).toMatchObject({ ok: true, data: { id: "exp_1" } });
    expect(calls[0]?.path).toBe("/api/v1/expenses");
    expect(calls[0]?.body).toMatchObject({ projectId: "pry_kairos_web", amount: "120.00" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/expenses", "layout");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("puts rateMissing on the currency field", async () => {
    useRoutes({
      "POST /api/v1/expenses": errorEnvelope("VALIDATION", {
        fieldErrors: { currency: ["expenses.errors.rateMissing"] },
      }),
    });
    const result = await createExpenseAction({
      date: "2026-10-05",
      description: "Hosting (MOCK)",
      categoryId: "cat_hosting",
      currency: "VES",
      amount: "100.00",
      usdRate: "0.02",
      status: "PENDIENTE",
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { currency: ["expenses.errors.rateMissing"] },
      },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateExpenseAction (Q-FEINT-11 (A))", () => {
  const edit = {
    id: "exp_1",
    date: "2026-10-05",
    description: "Hosting corregido (MOCK)",
    categoryId: "cat_hosting",
    currency: "USD",
    amount: "130.00",
    usdRate: "1",
  };

  it("patches a pending expense with the id in the path only", async () => {
    const { calls } = useRoutes({
      "PATCH /api/v1/expenses/{id}": { body: makeExpense({ amount: "130.00" }) },
    });
    const result = await updateExpenseAction(edit);
    expect(result).toMatchObject({ ok: true, data: { amount: "130.00" } });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.path).toBe("/api/v1/expenses/exp_1");
    expect(calls[0]?.body).not.toHaveProperty("id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/expenses/exp_1", "page");
  });

  it("returns the mapped CONFLICT notPending for an expense that is already paid", async () => {
    useRoutes({
      "PATCH /api/v1/expenses/{id}": errorEnvelope("CONFLICT", {
        message: "expenses.errors.notPending",
      }),
    });
    expect(await updateExpenseAction(edit)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "expenses.errors.notPending" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("markExpensePaidAction (C16)", () => {
  it("pays from an account in another currency and returns accountAmount as the BE stored it", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/expenses/{id}/pay": {
        body: makeExpense({
          status: "PAGADO",
          currency: "USD",
          amount: "120.00",
          accountAmount: "4380.00",
          paidAt: "2026-10-09",
          account: { id: "acc_ves", label: "Caja VES", code: null, type: "ACCOUNT" },
        }),
      },
    });
    const result = await markExpensePaidAction({
      id: "exp_1",
      accountId: "acc_ves",
      paidAt: "2026-10-09",
      currency: "USD",
      amount: "120.00",
      usdRate: "1",
      accountAmount: "4380.00",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "PAGADO", accountAmount: "4380.00" },
    });
    expect(calls[0]?.path).toBe("/api/v1/expenses/exp_1/pay");
    expect(calls[0]?.body).toMatchObject({ accountId: "acc_ves", accountAmount: "4380.00" });
    expect(calls[0]?.body).not.toHaveProperty("id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/expenses/exp_1", "page");
  });
});

describe("voidExpenseAction", () => {
  it("voids with the reason in the body and the id in the path", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/expenses/{id}/void": { body: makeExpense({ status: "ANULADO" }) },
    });
    const result = await voidExpenseAction({ id: "exp_1", reason: "Duplicado" });
    expect(result).toMatchObject({ ok: true, data: { status: "ANULADO" } });
    expect(calls[0]?.path).toBe("/api/v1/expenses/exp_1/void");
    expect(calls[0]?.body).toEqual({ reason: "Duplicado" });
  });
});

describe("recurring expenses (HU-17 CA3)", () => {
  it("creates a schedule", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/recurring-expenses": { status: 201, body: makeRecurringExpense() },
    });
    const result = await createRecurringExpenseAction({
      name: "Dominio anual (MOCK)",
      categoryId: "cat_hosting",
      currency: "USD",
      amount: "15.00",
      frequency: "ANUAL",
      dayOfPeriod: 10,
      leadDays: 5,
      startDate: "2026-01-10",
    });
    expect(result).toMatchObject({ ok: true, data: { id: "rex_1", usdRate: "1" } });
    expect(calls[0]?.path).toBe("/api/v1/recurring-expenses");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/expenses", "layout");
  });

  it("pauses and resumes through the status route", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/recurring-expenses/{id}/status": (call) => ({
        body: makeRecurringExpense({
          status: (call.body as { status: "ACTIVO" | "PAUSADO" }).status,
        }),
      }),
    });
    expect(await setRecurringExpenseStatusAction({ id: "rex_1", status: "PAUSADO" })).toMatchObject(
      { ok: true, data: { status: "PAUSADO" } },
    );
    expect(await setRecurringExpenseStatusAction({ id: "rex_1", status: "ACTIVO" })).toMatchObject({
      ok: true,
      data: { status: "ACTIVO" },
    });
    expect(calls.map((call) => call.body)).toEqual([{ status: "PAUSADO" }, { status: "ACTIVO" }]);
    expect(calls[0]?.path).toBe("/api/v1/recurring-expenses/rex_1/status");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/expenses/recurring/rex_1", "page");
  });
});

describe("searchExpensesAction (frozen)", () => {
  it("asks for 25, keeps 20 and returns EXPENSE refs", async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      makeExpense({
        id: `exp_${index}`,
        code: `GAS-${index}`,
        description: `Gasto ${index} (MOCK)`,
      }),
    );
    const { calls } = useRoutes({ "GET /api/v1/expenses": { body: page(rows, 25) } });
    const result = await searchExpensesAction({ q: "gasto" });
    if (!result.ok) throw new Error("search failed");
    expect(result.data).toHaveLength(20);
    expect(result.data[0]).toEqual({
      type: "EXPENSE",
      id: "exp_0",
      code: "GAS-0",
      label: "Gasto 0 (MOCK)",
    });
    expect(calls[0]?.search.get("q")).toBe("gasto");
    expect(calls[0]?.search.get("pageSize")).toBe("25");
  });

  it("returns FORBIDDEN for a role that may not read expenses", async () => {
    useRoutes({ "GET /api/v1/expenses": errorEnvelope("FORBIDDEN") });
    expect(await searchExpensesAction({ q: "" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("holds the frozen signature (type-level)", () => {
    expectTypeOf(searchExpensesAction).parameters.toEqualTypeOf<
      [input: { q?: string | undefined }]
    >();
    expectTypeOf(searchExpensesAction).returns.resolves.toEqualTypeOf<ActionResult<EntityRef[]>>();
  });
});
