import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);
vi.mock("next-intl/server", () => ({
  getLocale: async () => "es",
  getTranslations: async () => (key: string) => key,
}));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { ExchangeSnapshot } from "./exchange-snapshot";

const snapshotBody = {
  accountId: "acc_wallet",
  snapshot: {
    balances: [
      { asset: "BTC", free: "0.00012345", locked: "0.00000000" },
      { asset: "USDT", free: "1500.10", locked: "20.00" },
    ],
    // 10:00 UTC is 06:00 in America/Caracas (UTC-4, no DST).
    syncedAt: "2026-11-07T10:00:00.000Z",
  },
  systemBalance: { balance: "150.00", balanceUsd: "150.00", currency: "USD" },
};

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

const snapshotRoute = "GET /api/v1/accounts/{id}/exchange-snapshot";

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ExchangeSnapshot (6.4)", () => {
  it("shows the balances and the sync time of a wallet account", async () => {
    const { calls } = useRoutes({ [snapshotRoute]: { body: snapshotBody } });
    render(await ExchangeSnapshot({ accountId: "acc_wallet", accountType: "WALLET_CRIPTO" }));

    expect(calls[0]?.path).toBe("/api/v1/accounts/acc_wallet/exchange-snapshot");
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText("0.00012345")).toBeInTheDocument();
    expect(screen.getByText("USDT")).toBeInTheDocument();
    expect(screen.getByText("1500.10")).toBeInTheDocument();
    expect(screen.getByText("20.00")).toBeInTheDocument();
    expect(screen.getByText(/06:00/)).toBeInTheDocument();
  });

  it("renders nothing when the snapshot is null (Binance off, DT-193)", async () => {
    useRoutes({
      [snapshotRoute]: { body: { ...snapshotBody, snapshot: null } },
    });
    const { container } = render(
      await ExchangeSnapshot({ accountId: "acc_wallet", accountType: "WALLET_CRIPTO" }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not request the snapshot for a non-wallet account", async () => {
    const { calls } = useRoutes({ [snapshotRoute]: { body: snapshotBody } });
    const { container } = render(
      await ExchangeSnapshot({ accountId: "acc_bank", accountType: "BANCO_NACIONAL" }),
    );
    expect(calls).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the block when the read fails with a 5xx and does not throw", async () => {
    useRoutes({ [snapshotRoute]: errorEnvelope("INTERNAL") });
    const { container } = render(
      await ExchangeSnapshot({ accountId: "acc_wallet", accountType: "WALLET_CRIPTO" }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every amount exactly as the BE returned it", async () => {
    useRoutes({
      [snapshotRoute]: {
        body: {
          ...snapshotBody,
          snapshot: {
            balances: [{ asset: "SHIB", free: "1000000.50000000", locked: "0.00000001" }],
            syncedAt: "2026-11-07T10:00:00.000Z",
          },
        },
      },
    });
    render(await ExchangeSnapshot({ accountId: "acc_wallet", accountType: "WALLET_CRIPTO" }));
    expect(screen.getByText("1000000.50000000")).toBeInTheDocument();
    expect(screen.getByText("0.00000001")).toBeInTheDocument();
    expect(screen.queryByText(/1,000,000/)).not.toBeInTheDocument();
  });
});
