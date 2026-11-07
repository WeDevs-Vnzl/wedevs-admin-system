import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSessionUser: vi.fn(), getServerApi: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/features/expenses/components/expenses-overview", () => ({
  ExpensesOverview: () => null,
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makeSessionUser } from "@/lib/auth/testing";
import { makeExpense } from "@/features/expenses/test-fixtures";
import ExpensesOverviewPage from "./page";

const overview = {
  byMonthAndCategory: { periods: ["2026-10"], series: [{ id: "cat_1", values: ["120.00"] }] },
  byCategory: [{ key: "cat_1", label: "Hosting (MOCK)", value: "120.00" }],
  committedMonthly: "1.25",
  upcoming: [makeExpense()],
};

beforeEach(() => {
  mocks.requireSessionUser.mockReset();
  mocks.getServerApi.mockReset();
});

describe("/expenses overview (DT-175, C13)", () => {
  it("shows the BE overview to an Owner", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const { api, calls } = mockApi({ "GET /api/v1/expenses/overview": { body: overview } });
    mocks.getServerApi.mockResolvedValue(api);

    const element = await ExpensesOverviewPage();
    expect((element.props as { overview: typeof overview }).overview.committedMonthly).toBe("1.25");
    expect(calls[0]?.path).toBe("/api/v1/expenses/overview");
  });

  it("answers the not-found state for a Member without reading anything", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    await expect(ExpensesOverviewPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });

  it("answers the not-found state when the BE says FORBIDDEN (the BE is the rule)", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    const { api } = mockApi({ "GET /api/v1/expenses/overview": errorEnvelope("FORBIDDEN") });
    mocks.getServerApi.mockResolvedValue(api);
    await expect(ExpensesOverviewPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
