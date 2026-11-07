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
vi.mock("@/features/expenses/components/expense-form", () => ({ ExpenseForm: () => null }));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makeSessionUser } from "@/mocks/test-helpers";
import { makeExpense } from "@/features/expenses/test-fixtures";
import ExpenseEditPage from "./page";

const render = () => ExpenseEditPage({ params: Promise.resolve({ id: "exp_1" }) });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getExpenseFormOptions.mockResolvedValue({ accounts: [] });
});

describe("/expenses/[id]/edit (Q-FEINT-11 (A), DT-213)", () => {
  it("renders the create form over the stored expense", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/expenses/{id}": { body: makeExpense() } }).api,
    );
    const element = await render();
    const form = (element.props.children as { props: Record<string, unknown> }[])[1];
    expect(form?.props).toMatchObject({ expense: { id: "exp_1" }, options: { accounts: [] } });
  });

  it("hides the page from a Viewer without reading the expense", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });

  it("answers the not-found state for an unknown id", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/expenses/{id}": errorEnvelope("NOT_FOUND") }).api,
    );
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
