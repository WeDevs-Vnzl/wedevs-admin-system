import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);

import type { UserRole } from "@/lib/validators/enums";
import { makeSessionUser } from "@/mocks/test-helpers";
import { listExpensesAction, searchExpensesAction } from "./actions";
import { expenseFilterOf } from "./components/expense-table-query";

function signInAs(role: UserRole) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: `usr_${role}` }));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("listExpensesAction", () => {
  it("passes the facets, search and sort of the table query to the service", async () => {
    signInAs("ADMIN");
    const sorted = await listExpensesAction(
      expenseFilterOf({
        page: 1,
        pageSize: 25,
        sort: "amountUsd:desc",
        q: undefined,
        filters: { status: ["PAGADO", "ANULADO"] },
        includeArchived: false,
      }),
    );
    expect(sorted).toMatchObject({
      ok: true,
      data: {
        total: 3,
        items: [{ code: "GAS-0006" }, { code: "GAS-0001" }, { code: "GAS-0002" }],
      },
    });

    const ranged = await listExpensesAction(
      expenseFilterOf({
        page: 1,
        pageSize: 25,
        q: "kairos",
        filters: { status: ["PAGADO"], date: ["2026-10-01", "2026-10-31"] },
        includeArchived: false,
      }),
    );
    expect(ranged).toMatchObject({ ok: true, data: { total: 1, items: [{ code: "GAS-0002" }] } });
  });

  it("denies roles without the expense read grant", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      signInAs(role);
      expect(await listExpensesAction({})).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    }
  });

  it("rejects a sort outside the whitelist with VALIDATION", async () => {
    signInAs("OWNER");
    expect(await listExpensesAction({ sort: "category:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});

describe("searchExpensesAction (note link picker)", () => {
  it("returns expense refs matching q for a finance role", async () => {
    signInAs("ADMIN");
    const found = await searchExpensesAction({ q: "Hosting de producción" });
    expect(found).toMatchObject({
      ok: true,
      data: [
        {
          type: "EXPENSE",
          label: "Hosting de producción (MOCK)",
          code: expect.stringMatching(/^GAS-/),
        },
      ],
    });
  });

  it("refuses a role that may not read expenses", async () => {
    signInAs("VIEWER");
    expect(await searchExpensesAction({ q: "" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
