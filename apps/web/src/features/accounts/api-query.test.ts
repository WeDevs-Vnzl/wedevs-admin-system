import { describe, expect, it } from "vitest";
import { accountFilterSchema, accountLedgerQuerySchema } from "@/lib/validators/accounts";
import { toAccountListQuery, toLedgerQuery } from "./api-query";

describe("toAccountListQuery (api-contract §3)", () => {
  it("sends the page, the size, the sort and the search as flat keys", () => {
    const filter = accountFilterSchema.parse({
      page: 2,
      pageSize: 50,
      sort: "name:desc",
      q: "binance",
    });
    expect(toAccountListQuery(filter)).toMatchObject({
      page: 2,
      pageSize: 50,
      sort: "name:desc",
      q: "binance",
    });
  });

  it("sends the type, currency and status facets as lists and never sends archived", () => {
    const filter = accountFilterSchema.parse({
      type: "WALLET_CRIPTO",
      currency: ["USD", "VES"],
      status: ["inactive"],
    });
    const query = toAccountListQuery(filter);
    expect(query).toMatchObject({
      type: ["WALLET_CRIPTO"],
      currency: ["USD", "VES"],
      status: ["inactive"],
    });
    expect(query).not.toHaveProperty("archived");
  });

  it("asks for inactive accounts only when the screen does (the pickers do not)", () => {
    expect(toAccountListQuery(accountFilterSchema.parse({ pageSize: 100 }))).toMatchObject({
      pageSize: 100,
      includeInactive: "false",
    });
    expect(toAccountListQuery(accountFilterSchema.parse({ includeInactive: true }))).toMatchObject({
      includeInactive: "true",
    });
  });
});

describe("toLedgerQuery", () => {
  it("maps the entry kinds and the date range to the keys the BE reads", () => {
    const query = accountLedgerQuerySchema.parse({
      accountId: "acc_banco_ves",
      pageSize: 100,
      kind: "AJUSTE",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      sort: "date:desc",
    });
    expect(toLedgerQuery(query)).toEqual({
      page: 1,
      pageSize: 100,
      kind: ["AJUSTE"],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      sort: "date:desc",
    });
  });

  it("leaves the account id for the path", () => {
    const query = accountLedgerQuerySchema.parse({ accountId: "acc_banco_ves" });
    expect(toLedgerQuery(query)).not.toHaveProperty("accountId");
  });
});
