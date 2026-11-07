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
vi.mock("@/features/payments/components/payments-overview", () => ({
  PaymentsOverview: () => null,
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makePaymentRow, page } from "@/features/payments/test-fixtures";
import { makeSessionUser } from "@/lib/auth/testing";
import PaymentsOverviewPage from "./page";

const overview = {
  collectedByMonth: [{ period: "2026-10", value: "350.00" }],
  byMethod: [{ key: "pm_zelle", label: "Zelle", value: "350.00" }],
  byAccount: [{ key: "acc_usd", label: "Zelle USD", value: "350.00" }],
  pendingVerificationCount: 2,
  unallocatedCount: 1,
  unallocatedTotalUsd: "97.00",
};

beforeEach(() => {
  mocks.requireSessionUser.mockReset();
  mocks.getServerApi.mockReset();
});

describe("/payments overview (DT-175, C13)", () => {
  it("shows the BE overview and the payments with credit to an Owner", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const { api, calls } = mockApi({
      "GET /api/v1/payments/overview": { body: overview },
      "GET /api/v1/payments": { body: page([makePaymentRow()]) },
    });
    mocks.getServerApi.mockResolvedValue(api);

    const element = await PaymentsOverviewPage();
    const props = element.props as { overview: typeof overview; withCredit: { id: string }[] };
    expect(props.overview.unallocatedTotalUsd).toBe("97.00");
    expect(props.withCredit.map((row) => row.id)).toEqual(["pay_1"]);
    const list = calls.find((call) => call.path === "/api/v1/payments");
    expect(list?.search.getAll("status")).toEqual(["CONFIRMADO"]);
    expect(list?.search.get("hasUnallocated")).toBe("true");
  });

  it("answers the not-found state for a Member without reading anything", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    await expect(PaymentsOverviewPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });

  it("answers the not-found state when the BE says FORBIDDEN (the BE is the rule)", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    const { api } = mockApi({
      "GET /api/v1/payments/overview": errorEnvelope("FORBIDDEN"),
      "GET /api/v1/payments": errorEnvelope("FORBIDDEN"),
    });
    mocks.getServerApi.mockResolvedValue(api);
    await expect(PaymentsOverviewPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
