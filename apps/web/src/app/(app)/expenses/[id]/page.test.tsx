import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  getServerApi: vi.fn(),
  getExpenseFormOptions: vi.fn(),
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
vi.mock("@/features/expenses/form-options", () => ({
  getExpenseFormOptions: mocks.getExpenseFormOptions,
}));
vi.mock("@/components/app/breadcrumb-label", () => ({ BreadcrumbLabel: () => null }));
vi.mock("@/features/expenses/components/expense-detail", () => ({ ExpenseDetail: () => null }));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makeSessionUser } from "@/mocks/test-helpers";
import { makeExpense } from "@/features/expenses/test-fixtures";
import ExpenseDetailPage from "./page";

const render = () => ExpenseDetailPage({ params: Promise.resolve({ id: "exp_1" }) });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getExpenseFormOptions.mockResolvedValue({ accounts: [] });
});

describe("/expenses/[id]", () => {
  it("passes the BE expense to the detail with the cosmetic update grant", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/expenses/{id}": { body: makeExpense() } }).api,
    );
    const element = await render();
    const detail = (element.props.children as { props: Record<string, unknown> }[])[1];
    expect(detail?.props).toMatchObject({
      expense: { id: "exp_1", status: "PENDIENTE" },
      canUpdate: true,
    });
  });

  it("answers the not-found state for an unknown id", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/expenses/{id}": errorEnvelope("NOT_FOUND") }).api,
    );
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers the not-found state when the BE refuses the role", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/expenses/{id}": errorEnvelope("FORBIDDEN") }).api,
    );
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
