import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  requireSessionUser: vi.fn(),
  listCurrencies: vi.fn(),
  getPreferences: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/lib/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/features/catalogs/queries", () => ({ listCurrencies: mocks.listCurrencies }));
vi.mock("@/features/preferences/queries", () => ({ getPreferences: mocks.getPreferences }));
vi.mock("@/components/patterns/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/components/patterns/overview-table-toggle", () => ({ OverviewTableToggle: () => null }));
vi.mock("@/features/invoices/components/invoices-table", () => ({
  InvoicesTable: ({
    initialRows,
    initialTotal,
  }: {
    initialRows: unknown[];
    initialTotal: number;
  }) => <p>{`rows:${initialRows.length}|total:${initialTotal}`}</p>,
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { invoiceListItem, invoicePage } from "@/features/invoices/test-data";
import InvoicesListPage from "./page";

const searchParams = Promise.resolve({});

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  mocks.requireSessionUser.mockResolvedValue({ id: `usr_${role}`, role });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCurrencies.mockResolvedValue([{ code: "USD" }]);
  mocks.getPreferences.mockResolvedValue({ tableColumns: { invoices: undefined } });
});

describe("/invoices/list", () => {
  it("shows the BE page for Owner and Admin", async () => {
    asRole("OWNER");
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/invoices": { body: invoicePage([invoiceListItem()], { total: 41 }) } })
        .api,
    );
    render(await InvoicesListPage({ searchParams }));
    expect(screen.getByText("rows:1|total:41")).toBeInTheDocument();
  });

  it("gives the no-permission state when the BE refuses the role (FORBIDDEN)", async () => {
    asRole("ADMIN");
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/invoices": errorEnvelope("FORBIDDEN") }).api,
    );
    await expect(InvoicesListPage({ searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("gives Member and Viewer the no-permission state before any read", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      asRole(role);
      await expect(InvoicesListPage({ searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });
});
