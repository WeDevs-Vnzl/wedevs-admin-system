import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  getServerApi: vi.fn(),
  listAccounts: vi.fn(),
  listPaymentMethods: vi.fn(),
  listCurrencies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/server/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/features/accounts/queries", () => ({ listAccounts: mocks.listAccounts }));
vi.mock("@/features/catalogs/queries", () => ({
  listPaymentMethods: mocks.listPaymentMethods,
  listCurrencies: mocks.listCurrencies,
}));
vi.mock("@/features/payments/components/payments-table", () => ({ PaymentsTable: () => null }));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makePaymentRow, page } from "@/features/payments/test-fixtures";
import { makeSessionUser } from "@/mocks/test-helpers";
import PaymentsListPage from "./page";

const render = () => PaymentsListPage({ searchParams: Promise.resolve({}) });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listAccounts.mockResolvedValue({ items: [] });
  mocks.listPaymentMethods.mockResolvedValue([]);
  mocks.listCurrencies.mockResolvedValue([]);
});

describe("/payments/list", () => {
  it("renders the first BE page for a finance role", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments": { body: page([makePaymentRow()]) } }).api,
    );
    const element = await render();
    const table = (element.props.children as { props: Record<string, unknown> }[])[1];
    expect(table?.props).toMatchObject({ initialRows: [{ id: "pay_1" }], initialTotal: 1 });
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "answers the not-found state for a %s without reading the list",
    async (role) => {
      mocks.requireSessionUser.mockResolvedValue(makeSessionUser(role));
      await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.getServerApi).not.toHaveBeenCalled();
    },
  );

  it("answers the not-found state when the BE says FORBIDDEN", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments": errorEnvelope("FORBIDDEN") }).api,
    );
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
