import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  getServerApi: vi.fn(),
  listAccounts: vi.fn(),
  listPaymentMethods: vi.fn(),
  getFiscalSettings: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/features/accounts/queries", () => ({ listAccounts: mocks.listAccounts }));
vi.mock("@/features/catalogs/queries", () => ({
  listPaymentMethods: mocks.listPaymentMethods,
  getFiscalSettings: mocks.getFiscalSettings,
}));
vi.mock("@/features/payments/components/payment-form", () => ({ PaymentForm: () => null }));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makeOpenInvoice } from "@/features/payments/test-fixtures";
import { makeSessionUser } from "@/lib/auth/testing";
import NewPaymentPage from "./page";

const render = (searchParams: Record<string, string | undefined> = {}) =>
  NewPaymentPage({ searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
  mocks.listAccounts.mockResolvedValue({
    items: [
      { id: "acc_usd", name: "Zelle USD", currency: "USD", active: true },
      { id: "acc_old", name: "Old", currency: "USD", active: false },
    ],
  });
  mocks.listPaymentMethods.mockResolvedValue([
    {
      id: "pm_1",
      code: "ZELLE",
      name: "Zelle",
      nameEn: null,
      requiresReference: true,
      suggestsIgtf: true,
      active: true,
    },
  ]);
  mocks.getFiscalSettings.mockResolvedValue({
    igtfRate: "3",
    igtfCurrencies: ["USD"],
    ivaRates: ["16"],
  });
});

describe("/payments/new (HU-13)", () => {
  it("offers the active accounts and only the fiscal IGTF sources the BE has (rate and currencies)", async () => {
    mocks.getServerApi.mockResolvedValue(mockApi({}).api);
    const element = await render();
    expect(element.props).toMatchObject({
      accounts: [{ id: "acc_usd", name: "Zelle USD", currency: "USD" }],
      fiscal: { igtfRate: "3", igtfCurrencies: ["USD"] },
      initialOpenInvoices: [],
    });
    expect(Object.keys(element.props.fiscal).sort()).toEqual(["igtfCurrencies", "igtfRate"]);
    expect(element.props.initialClient).toBeNull();
  });

  it("preselects the client and the invoice of ?invoiceId=", async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/invoices/{id}/payment-context": {
        body: {
          client: { id: "cli_1", code: null, label: "Kairos Studio", type: "CLIENT" },
          invoice: makeOpenInvoice(),
        },
      },
      "GET /api/v1/clients/{id}/open-invoices": { body: [makeOpenInvoice()] },
    });
    mocks.getServerApi.mockResolvedValue(api);
    const element = await render({ invoiceId: "inv_1" });
    expect(element.props).toMatchObject({
      initialClient: { id: "cli_1", name: "Kairos Studio" },
      initialInvoiceId: "inv_1",
      initialOpenInvoices: [{ id: "inv_1", balance: "300.00" }],
    });
    expect(calls.map((call) => call.path)).toContain("/api/v1/clients/cli_1/open-invoices");
  });

  it("opens the empty form when the invoice takes no payment (payment-context 404, DT-133)", async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/invoices/{id}/payment-context": errorEnvelope("NOT_FOUND"),
    });
    mocks.getServerApi.mockResolvedValue(api);
    const element = await render({ invoiceId: "inv_paid" });
    expect(element.props.initialClient).toBeNull();
    expect(element.props.initialInvoiceId).toBeUndefined();
    expect(element.props.initialOpenInvoices).toEqual([]);
    expect(calls.map((call) => call.path)).not.toContain("/api/v1/clients/cli_1/open-invoices");
  });

  it("answers the not-found state for a role that may not create payments", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });
});
