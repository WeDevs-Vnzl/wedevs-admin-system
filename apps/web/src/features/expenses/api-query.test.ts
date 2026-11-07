import { describe, expect, it } from "vitest";
import { listQuerySchema } from "@/lib/validators/common";
import { expenseFiltersSchema, recurringExpenseFiltersSchema } from "@/lib/validators/expenses";
import { expenseFilterOf } from "./components/expense-table-query";
import { toExpenseListQuery, toRecurringExpenseListQuery } from "./api-query";

describe("toExpenseListQuery (api-contract §3)", () => {
  it("sends the page, the size, the sort and the search as flat keys", () => {
    const filter = expenseFiltersSchema.parse({
      page: 2,
      pageSize: 50,
      sort: "amountUsd:desc",
      q: "hosting",
    });
    expect(toExpenseListQuery(filter)).toMatchObject({
      page: 2,
      pageSize: 50,
      sort: "amountUsd:desc",
      q: "hosting",
    });
  });

  it("sends every facet, including currency and tagId, as a list", () => {
    const filter = expenseFiltersSchema.parse({
      status: ["PAGADO", "ANULADO"],
      categoryId: "cat_1",
      accountId: "acc_1",
      projectId: "pry_1",
      currency: ["USD", "VES"],
      tagId: "tag_1",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(toExpenseListQuery(filter)).toMatchObject({
      status: ["PAGADO", "ANULADO"],
      categoryId: ["cat_1"],
      accountId: ["acc_1"],
      projectId: ["pry_1"],
      currency: ["USD", "VES"],
      tagId: ["tag_1"],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
  });

  it("sends recurringOnly as the string the BE reads and omits absent filters", () => {
    expect(toExpenseListQuery(expenseFiltersSchema.parse({ recurringOnly: true }))).toMatchObject({
      recurringOnly: "true",
    });
    const bare = toExpenseListQuery(expenseFiltersSchema.parse({}));
    expect(bare).not.toHaveProperty("status");
    expect(bare).not.toHaveProperty("recurringOnly");
    expect(bare).not.toHaveProperty("archived");
  });
});

describe("toRecurringExpenseListQuery", () => {
  it("sends the status, category and frequency facets and the amount sort", () => {
    const filter = recurringExpenseFiltersSchema.parse({
      status: "ACTIVO",
      categoryId: "cat_1",
      frequency: ["MENSUAL", "ANUAL"],
      sort: "amount:desc",
      pageSize: 100,
    });
    expect(toRecurringExpenseListQuery(filter)).toMatchObject({
      status: ["ACTIVO"],
      categoryId: ["cat_1"],
      frequency: ["MENSUAL", "ANUAL"],
      sort: "amount:desc",
      pageSize: 100,
    });
  });

  it("drops a sort the contract does not accept (nextDueDate) instead of sending it", () => {
    const filter = recurringExpenseFiltersSchema.parse({ sort: "nextDueDate:asc" });
    expect(toRecurringExpenseListQuery(filter)).not.toHaveProperty("sort");
  });
});

describe("the table's currency facet", () => {
  it("reaches GET /expenses as the currency list", () => {
    const filter = expenseFiltersSchema.parse(
      expenseFilterOf(listQuerySchema.parse({ filters: { currency: ["VES"] } })),
    );
    expect(toExpenseListQuery(filter)).toMatchObject({ currency: ["VES"] });
  });
});
