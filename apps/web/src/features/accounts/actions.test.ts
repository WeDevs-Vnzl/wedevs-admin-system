import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { listQuerySchema } from "@/lib/validators/common";
import {
  createAccountAction,
  createMovementAction,
  createTransferAction,
  listAccountsAction,
  reconcileAccountAction,
  updateAccountAction,
} from "./actions";
import { accountFilterOf } from "./components/account-table-query";

const account = {
  id: "acc_binance",
  name: "Binance",
  type: "WALLET_CRIPTO",
  institution: "Binance",
  currency: "USDT",
  identifierMasked: "0x1a…9f3c",
  holderName: null,
  openingBalance: "100.00",
  openingDate: "2026-01-01",
  active: true,
  notes: null,
  balance: "250.50",
  balanceUsd: "250.50",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

/** The filter the table sends for a URL state (facets nested under `filters`, as `useTableUrlState` gives). */
const tableFilter = (input: Record<string, unknown>) =>
  accountFilterOf(listQuerySchema.parse(input));

beforeEach(() => {
  mocks.getServerApi.mockReset();
  mocks.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createAccountAction / updateAccountAction (HU-15, DT-122)", () => {
  it("creates through POST /api/v1/accounts and refreshes the list pages", async () => {
    const { calls } = useRoutes({ "POST /api/v1/accounts": { status: 201, body: account } });
    const result = await createAccountAction({
      name: "Binance",
      type: "WALLET_CRIPTO",
      currency: "USDT",
      openingBalance: "100.00",
      openingDate: "2026-01-01",
      active: true,
    });
    expect(result).toMatchObject({ ok: true, data: { id: "acc_binance" } });
    expect(calls[0]?.body).toMatchObject({ name: "Binance", openingBalance: "100.00" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts/list");
  });

  it("updates through PATCH /api/v1/accounts/{id} with the id in the path only", async () => {
    const { calls } = useRoutes({ "PATCH /api/v1/accounts/{id}": { body: account } });
    await updateAccountAction({
      id: "acc_binance",
      name: "Binance",
      type: "WALLET_CRIPTO",
      currency: "USDT",
      openingBalance: "100.00",
      openingDate: "2026-01-01",
      active: true,
    });
    expect(calls[0]?.path).toBe("/api/v1/accounts/acc_binance");
    expect(calls[0]?.body).not.toHaveProperty("id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts/acc_binance");
  });

  it("returns the mapped INTEGRITY_LOCK when the account has movements and the BE refuses", async () => {
    useRoutes({
      "PATCH /api/v1/accounts/{id}": errorEnvelope("INTEGRITY_LOCK", {
        message: "accounts.validation.currencyLocked",
      }),
    });
    const result = await updateAccountAction({
      id: "acc_binance",
      name: "Binance",
      type: "WALLET_CRIPTO",
      currency: "VES",
      openingBalance: "100.00",
      openingDate: "2026-01-01",
      active: false,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "accounts.validation.currencyLocked" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createTransferAction (HU-16)", () => {
  const transfer = {
    date: "2026-11-01",
    fromAccountId: "acc_a",
    toAccountId: "acc_b",
    amountFrom: "100.00",
    amountTo: "100.00",
    feeAmount: "0",
    usdRate: "1",
  };

  it("posts the transfer and keeps the amounts as decimal strings", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/transfers": {
        status: 201,
        body: { id: "trf_1", fromAccount: { id: "acc_a" }, toAccount: { id: "acc_b" } },
      },
    });
    const result = await createTransferAction(transfer);
    expect(result).toMatchObject({ ok: true, data: { id: "trf_1" } });
    expect(calls[0]?.body).toMatchObject({ amountFrom: "100.00", amountTo: "100.00" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("shows the BE 422 for a transfer to the same account on the destination field", async () => {
    useRoutes({
      "POST /api/v1/transfers": errorEnvelope("VALIDATION", {
        fieldErrors: { toAccountId: ["accounts.validation.sameAccount"] },
      }),
    });
    const result = await createTransferAction({ ...transfer, toAccountId: "acc_a" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { toAccountId: ["accounts.validation.sameAccount"] },
      },
    });
  });
});

describe("createMovementAction (HU-16)", () => {
  it("posts a partner contribution on the account path without repeating the id in the body", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/accounts/{id}/movements": {
        status: 201,
        body: { id: "mov_1", account: { id: "acc_a" }, partner: { id: "usr_camila_torres" } },
      },
    });
    const result = await createMovementAction({
      accountId: "acc_a",
      type: "APORTE_CAPITAL",
      date: "2026-11-01",
      amount: "500.00",
      usdRate: "1",
      partnerId: "usr_camila_torres",
      description: "Aporte",
    });
    expect(result).toMatchObject({ ok: true, data: { id: "mov_1" } });
    expect(calls[0]?.path).toBe("/api/v1/accounts/acc_a/movements");
    expect(calls[0]?.body).toMatchObject({ partnerId: "usr_camila_torres", amount: "500.00" });
    expect(calls[0]?.body).not.toHaveProperty("accountId");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts/acc_a");
  });

  it("returns the BE 422 for a zero adjustment on the amount field", async () => {
    useRoutes({
      "POST /api/v1/accounts/{id}/movements": errorEnvelope("VALIDATION", {
        fieldErrors: { amount: ["accounts.validation.adjustmentNonZero"] },
      }),
    });
    const result = await createMovementAction({
      accountId: "acc_a",
      type: "AJUSTE",
      date: "2026-11-01",
      amount: "0",
      usdRate: "1",
      description: "Ajuste",
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { amount: ["accounts.validation.adjustmentNonZero"] },
      },
    });
  });
});

describe("reconcileAccountAction (HU-15 CA3, DT-123)", () => {
  it("posts the statement and returns the stored row with the suggested adjustment as sent", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/accounts/{id}/reconcile": {
        body: {
          id: "rec_1",
          accountId: "acc_a",
          date: "2026-11-01",
          statementBalance: "120.00",
          systemBalance: "100.00",
          difference: "20.00",
          suggestedAdjustment: "20.00",
          notes: null,
          createdAt: "2026-11-01T12:00:00.000Z",
        },
      },
    });
    const result = await reconcileAccountAction({
      accountId: "acc_a",
      date: "2026-11-01",
      statementBalance: "120.00",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { difference: "20.00", suggestedAdjustment: "20.00", systemBalance: "100.00" },
    });
    expect(calls[0]?.path).toBe("/api/v1/accounts/acc_a/reconcile");
    expect(calls[0]?.body).toEqual({ date: "2026-11-01", statementBalance: "120.00" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts/acc_a");
  });
});

describe("listAccountsAction", () => {
  const page = { items: [account], total: 1, page: 1, pageSize: 25, pageCount: 1 };

  it("passes the facets and the sort to GET /api/v1/accounts", async () => {
    const { calls } = useRoutes({ "GET /api/v1/accounts": { body: page } });
    const result = await listAccountsAction(
      tableFilter({ filters: { currency: ["VES"], type: ["WALLET_CRIPTO"] }, sort: "name:desc" }),
    );
    expect(result).toMatchObject({ ok: true, data: { total: 1, items: [{ id: "acc_binance" }] } });
    expect(calls[0]?.search.getAll("currency")).toEqual(["VES"]);
    expect(calls[0]?.search.getAll("type")).toEqual(["WALLET_CRIPTO"]);
    expect(calls[0]?.search.get("sort")).toBe("name:desc");
    expect(calls[0]?.search.get("includeInactive")).toBe("true");
  });

  it("answers FORBIDDEN as the BE does for a role without the account grant", async () => {
    useRoutes({ "GET /api/v1/accounts": errorEnvelope("FORBIDDEN") });
    expect(await listAccountsAction(tableFilter({}))).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("rejects a sort outside the table columns without calling the BE", async () => {
    const { calls } = useRoutes({ "GET /api/v1/accounts": { body: page } });
    expect(await listAccountsAction({ sort: "holderName:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });
});
