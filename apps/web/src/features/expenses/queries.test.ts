import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ExpenseListResponseDto, ExpenseResponseDto } from "@/lib/api/types/expenses";
import type { ExpenseFiltersInput } from "@/lib/validators/expenses";
import {
  getExpense,
  getExpensesOverview,
  getRecurringExpense,
  listExpenses,
  listRecurringExpenses,
} from "./queries";
import { makeExpense, makeRecurringExpense, page } from "./test-fixtures";

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const overview = {
  byMonthAndCategory: { periods: ["2026-10"], series: [{ id: "cat_1", values: ["120.00"] }] },
  byCategory: [{ key: "cat_1", label: "Hosting (MOCK)", value: "120.00" }],
  committedMonthly: "1.25",
  upcoming: [makeExpense()],
};

describe("getExpensesOverview (DT-175)", () => {
  it("reads GET /api/v1/expenses/overview for an Owner", async () => {
    const { calls } = useRoutes({ "GET /api/v1/expenses/overview": { body: overview } });
    const result = await getExpensesOverview();
    expect(result.committedMonthly).toBe("1.25");
    expect(result.upcoming[0]?.code).toBe("GAS-0001");
    expect(calls[0]?.path).toBe("/api/v1/expenses/overview");
  });

  it("throws ServiceError FORBIDDEN for a Member (C13)", async () => {
    useRoutes({ "GET /api/v1/expenses/overview": errorEnvelope("FORBIDDEN") });
    await expect(getExpensesOverview()).rejects.toMatchObject({
      name: "ServiceError",
      code: "FORBIDDEN",
    });
  });
});

describe("listExpenses", () => {
  it("filters by project for the project Gastos tab", async () => {
    const { calls } = useRoutes({ "GET /api/v1/expenses": { body: page([makeExpense()]) } });
    const result = await listExpenses({ projectId: "pry_1", pageSize: 100, sort: "date:desc" });
    expect(result.items).toHaveLength(1);
    expect(calls[0]?.search.getAll("projectId")).toEqual(["pry_1"]);
    expect(calls[0]?.search.get("pageSize")).toBe("100");
    expect(calls[0]?.search.get("sort")).toBe("date:desc");
  });
});

describe("getExpense / getRecurringExpense / listRecurringExpenses", () => {
  it("maps 404 to ServiceError NOT_FOUND", async () => {
    useRoutes({ "GET /api/v1/expenses/{id}": errorEnvelope("NOT_FOUND") });
    await expect(getExpense("exp_missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads one schedule with its USD snapshot", async () => {
    useRoutes({ "GET /api/v1/recurring-expenses/{id}": { body: makeRecurringExpense() } });
    expect(await getRecurringExpense("rex_1")).toMatchObject({ id: "rex_1", usdRate: "1" });
  });

  it("lists schedules with the status and frequency facets", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/recurring-expenses": { body: page([makeRecurringExpense()]) },
    });
    await listRecurringExpenses({ status: "PAUSADO", frequency: ["MENSUAL"], sort: "amount:desc" });
    expect(calls[0]?.search.getAll("status")).toEqual(["PAUSADO"]);
    expect(calls[0]?.search.getAll("frequency")).toEqual(["MENSUAL"]);
    expect(calls[0]?.search.get("sort")).toBe("amount:desc");
  });

  it("types the reads on the generated DTOs", () => {
    expectTypeOf(listExpenses).parameter(0).toEqualTypeOf<ExpenseFiltersInput | undefined>();
    expectTypeOf(listExpenses).returns.resolves.toEqualTypeOf<ExpenseListResponseDto>();
    expectTypeOf(getExpense).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf(getExpense).returns.resolves.toEqualTypeOf<ExpenseResponseDto>();
  });
});
