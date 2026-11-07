import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { getIntegrationsScreen } from "./queries";

const account = (id: string, type: string, currency = "USD") => ({
  id,
  name: `Account ${id}`,
  type,
  currency,
  active: true,
});
const accountsBody = {
  items: [
    account("a1", "BANCO"),
    account("w1", "WALLET_CRIPTO", "USDT"),
    account("a2", "CAJA", "EUR"),
  ],
  page: 1,
  pageSize: 100,
  total: 3,
};
const methodsBody = [
  { id: "pm1", code: "STRIPE", name: "Stripe", nameEn: null, active: true },
  { id: "pm2", code: "CASH", name: "Efectivo", nameEn: "Cash", active: true },
];
const mapping = { stripe: { accountId: "a1", paymentMethodId: "pm1" }, binance: null };

const routes = (overrides: RouteTable = {}): RouteTable => ({
  "GET /api/v1/settings/integrations": { body: mapping },
  "GET /api/v1/accounts": { body: accountsBody },
  "GET /api/v1/payment-methods": { body: methodsBody },
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("getIntegrationsScreen", () => {
  it("returns the mapping, every account for Stripe, wallet accounts only for Binance and the methods", async () => {
    mocks.getServerApi.mockResolvedValue(mockApi(routes()).api);
    const screen = await getIntegrationsScreen("en");
    expect(screen.mapping).toEqual(mapping);
    expect(screen.accounts.map((a) => a.id)).toEqual(["a1", "w1", "a2"]);
    expect(screen.accounts[0]).toEqual({ id: "a1", name: "Account a1", currency: "USD" });
    expect(screen.walletAccounts.map((a) => a.id)).toEqual(["w1"]);
    expect(screen.methods).toEqual([
      { id: "pm1", label: "Stripe" },
      { id: "pm2", label: "Cash" },
    ]);
  });

  it("shows the Spanish method name in Spanish", async () => {
    mocks.getServerApi.mockResolvedValue(mockApi(routes()).api);
    expect((await getIntegrationsScreen("es")).methods[1]?.label).toBe("Efectivo");
  });

  it("is the in-shell not-found state for a role without the settings grant", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi(routes({ "GET /api/v1/settings/integrations": errorEnvelope("FORBIDDEN") })).api,
    );
    await expect(getIntegrationsScreen("en")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sends an unauthenticated caller to sign-in", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi(routes({ "GET /api/v1/settings/integrations": errorEnvelope("UNAUTHENTICATED") }))
        .api,
    );
    await expect(getIntegrationsScreen("en")).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });
});
