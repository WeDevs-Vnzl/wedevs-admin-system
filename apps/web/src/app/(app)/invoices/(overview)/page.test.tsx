import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn(), requireSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/server/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/features/invoices/components/invoices-overview", () => ({
  InvoicesOverview: ({ overview }: { overview: { overdueCount: number } }) => (
    <p>{`overdue:${overview.overdueCount}`}</p>
  ),
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import InvoicesOverviewPage from "./page";

const overview = {
  billedVsCollected: { periods: [], series: [] },
  aging: { d0_30: "0.00", d31_60: "0.00", d61_90: "0.00", d90plus: "0.00" },
  overdueCount: 3,
  totalsByCurrency: [],
};

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  mocks.requireSessionUser.mockResolvedValue({ id: `usr_${role}`, role });
}

beforeEach(() => vi.clearAllMocks());

describe("/invoices overview (Q-FEINT-8 (A), DT-175)", () => {
  it("shows the BE overview for the Owner", async () => {
    asRole("OWNER");
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/invoices/overview": { body: overview } }).api,
    );
    render(await InvoicesOverviewPage());
    expect(screen.getByText("overdue:3")).toBeInTheDocument();
  });

  it("answers the no-permission state when the BE says FORBIDDEN, and for Member before any read", async () => {
    asRole("ADMIN");
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/invoices/overview": errorEnvelope("FORBIDDEN") }).api,
    );
    await expect(InvoicesOverviewPage()).rejects.toThrow("NEXT_NOT_FOUND");

    mocks.getServerApi.mockClear();
    asRole("MEMBER");
    await expect(InvoicesOverviewPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });
});
