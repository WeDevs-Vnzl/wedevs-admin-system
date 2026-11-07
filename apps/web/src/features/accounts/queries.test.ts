import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);

import type { AccountListResponseDto, AccountResponseDto } from "@/lib/api/types/accounts";
import type { ExchangeSnapshotResponseDto } from "@/lib/api/types/exchange-snapshot";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ActionResult } from "@/lib/validators/common";
import type { AccountFilterInput } from "@/lib/validators/accounts";
import { ServiceError } from "@/server/errors";
import { listAccountsAction } from "./actions";
import {
  getAccount,
  getAccountExchangeSnapshot,
  getAccountLedger,
  getAccountsOverview,
  listAccountPartners,
  listAccounts,
} from "./queries";

const account = {
  id: "acc_banco_ves",
  name: "Banco VES",
  type: "BANCO_NACIONAL",
  institution: "Banesco",
  currency: "VES",
  identifierMasked: "•••• 1234",
  holderName: null,
  openingBalance: "1000.00",
  openingDate: "2026-01-01",
  active: true,
  notes: null,
  balance: "1500.00",
  balanceUsd: "30.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listAccounts (the account picker, frozen)", () => {
  it("reads one page for the pickers with pageSize 100", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/accounts": {
        body: { items: [account], total: 1, page: 1, pageSize: 100, pageCount: 1 },
      },
    });
    const result = await listAccounts({ pageSize: 100 });
    expect(
      result.items.map(({ id, name, currency, active }) => ({ id, name, currency, active })),
    ).toEqual([{ id: "acc_banco_ves", name: "Banco VES", currency: "VES", active: true }]);
    expect(result.total).toBe(1);
    expect(calls[0]?.search.get("pageSize")).toBe("100");
  });

  it("throws ServiceError FORBIDDEN when the BE refuses the role", async () => {
    useRoutes({ "GET /api/v1/accounts": errorEnvelope("FORBIDDEN") });
    await expect(listAccounts()).rejects.toMatchObject({
      name: "ServiceError",
      code: "FORBIDDEN",
    });
  });

  it("holds the frozen signatures (type-level)", () => {
    expectTypeOf(listAccounts).parameter(0).toEqualTypeOf<AccountFilterInput | undefined>();
    expectTypeOf(listAccounts).returns.resolves.toEqualTypeOf<AccountListResponseDto>();
    expectTypeOf(getAccount).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf(getAccount).returns.resolves.toEqualTypeOf<AccountResponseDto>();
    expectTypeOf(listAccountsAction).parameters.toEqualTypeOf<[input: AccountFilterInput]>();
    expectTypeOf(listAccountsAction).returns.resolves.toEqualTypeOf<
      ActionResult<AccountListResponseDto>
    >();
    // The fields the W3/W4 consumers read.
    expectTypeOf<AccountListResponseDto["items"][number]>().toHaveProperty("id");
    expectTypeOf<AccountListResponseDto["items"][number]["id"]>().toBeString();
    expectTypeOf<AccountListResponseDto["items"][number]["name"]>().toBeString();
    expectTypeOf<AccountListResponseDto["items"][number]["currency"]>().toBeString();
    expectTypeOf<AccountListResponseDto["items"][number]["active"]>().toBeBoolean();
    expectTypeOf<AccountListResponseDto["total"]>().toBeNumber();
    expectTypeOf<AccountResponseDto["type"]>().toBeString();
  });
});

describe("getAccount", () => {
  it("reads one account through GET /api/v1/accounts/{id}", async () => {
    const { calls } = useRoutes({ "GET /api/v1/accounts/{id}": { body: account } });
    await expect(getAccount("acc_banco_ves")).resolves.toMatchObject({
      id: "acc_banco_ves",
      name: "Banco VES",
      currency: "VES",
      type: "BANCO_NACIONAL",
    });
    expect(calls[0]?.path).toBe("/api/v1/accounts/acc_banco_ves");
  });

  it("throws ServiceError NOT_FOUND for a 404", async () => {
    useRoutes({ "GET /api/v1/accounts/{id}": errorEnvelope("NOT_FOUND") });
    const error = await getAccount("acc_missing").catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getAccountLedger (HU-15 CA2)", () => {
  it("returns the entries and the running balance exactly as the BE computed them", async () => {
    const entries = [
      {
        id: "led_1",
        date: "2026-01-01",
        kind: "OPENING_BALANCE",
        source: null,
        description: null,
        amount: "1000.00",
        balance: "1000.00",
      },
      {
        id: "led_2",
        date: "2026-02-01",
        kind: "TRANSFER_OUT",
        source: { id: "trf_1", type: "TRANSFER", label: "TRF" },
        description: null,
        amount: "-250.25",
        balance: "749.75",
      },
    ];
    const { calls } = useRoutes({
      "GET /api/v1/accounts/{id}/ledger": {
        body: { items: entries, total: 2, page: 1, pageSize: 100, pageCount: 1 },
      },
    });
    const ledger = await getAccountLedger({ accountId: "acc_banco_ves", pageSize: 100 });
    expect(ledger.items).toEqual(entries);
    expect(calls[0]?.path).toBe("/api/v1/accounts/acc_banco_ves/ledger");
    expect(calls[0]?.search.get("pageSize")).toBe("100");
    expect(calls[0]?.search.has("accountId")).toBe(false);
  });
});

describe("getAccountsOverview (Q-FEINT-8, DT-175)", () => {
  it("reads GET /api/v1/accounts/overview for the Owner", async () => {
    useRoutes({
      "GET /api/v1/accounts/overview": { body: { accounts: [account], totalBalanceUsd: "30.00" } },
    });
    await expect(getAccountsOverview()).resolves.toMatchObject({ totalBalanceUsd: "30.00" });
  });

  it("throws ServiceError FORBIDDEN for a Member", async () => {
    useRoutes({ "GET /api/v1/accounts/overview": errorEnvelope("FORBIDDEN") });
    await expect(getAccountsOverview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("listAccountPartners", () => {
  it("reads GET /api/v1/accounts/partners", async () => {
    useRoutes({ "GET /api/v1/accounts/partners": { body: [{ id: "usr_1", name: "Camila" }] } });
    await expect(listAccountPartners()).resolves.toEqual([{ id: "usr_1", name: "Camila" }]);
  });
});

describe("getAccountExchangeSnapshot (6.4)", () => {
  const snapshotBody: ExchangeSnapshotResponseDto = {
    accountId: "acc_wallet",
    snapshot: {
      balances: [
        { asset: "BTC", free: "0.00012345", locked: "0.00000000" },
        { asset: "USDT", free: "1500.10", locked: "20.00" },
      ],
      syncedAt: "2026-11-07T10:00:00.000Z",
    },
    systemBalance: { balance: "150.00", balanceUsd: "150.00", currency: "USD" },
  };

  it("reads GET /api/v1/accounts/{id}/exchange-snapshot and keeps every amount as the BE returned it", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/accounts/{id}/exchange-snapshot": { body: snapshotBody },
    });
    await expect(getAccountExchangeSnapshot("acc_wallet")).resolves.toEqual(snapshotBody);
    expect(calls[0]?.path).toBe("/api/v1/accounts/acc_wallet/exchange-snapshot");
  });

  it("keeps snapshot null while the Binance integration is off (DT-193)", async () => {
    useRoutes({
      "GET /api/v1/accounts/{id}/exchange-snapshot": {
        body: { ...snapshotBody, snapshot: null },
      },
    });
    await expect(getAccountExchangeSnapshot("acc_wallet")).resolves.toMatchObject({
      snapshot: null,
    });
  });

  it("throws ServiceError with the BE code for a 5xx", async () => {
    useRoutes({
      "GET /api/v1/accounts/{id}/exchange-snapshot": errorEnvelope("INTERNAL"),
    });
    const error = await getAccountExchangeSnapshot("acc_wallet").catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ code: "INTERNAL" });
  });

  it("holds the frozen signature (type-level)", () => {
    expectTypeOf(getAccountExchangeSnapshot).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf(
      getAccountExchangeSnapshot,
    ).returns.resolves.toEqualTypeOf<ExchangeSnapshotResponseDto>();
  });
});
