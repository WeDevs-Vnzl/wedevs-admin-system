import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);

import type { ListQuery } from "@/lib/validators/common";
import type { UserRole } from "@/lib/validators/enums";
import { mockId } from "@/mocks/ids";
import { makeSessionUser } from "@/mocks/test-helpers";
import { listInvoicesAction } from "./actions";
import { invoiceFilterOf } from "./components/invoice-table-query";

const KAIROS = mockId("cli", "kairos");

/** A table list query (the kit's URL state) with the defaults the table starts from. */
function listQuery(overrides: Partial<ListQuery>): ListQuery {
  return { page: 1, pageSize: 25, q: undefined, includeArchived: false, filters: {}, ...overrides };
}

function signInAs(role: UserRole) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: `usr_${role}` }));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("listInvoicesAction", () => {
  it("applies the table facets (client, issue-date range) and the header sort", async () => {
    signInAs("ADMIN");
    const result = await listInvoicesAction(
      invoiceFilterOf(
        listQuery({
          page: 1,
          pageSize: 25,
          sort: "invoiceNumber:asc",
          includeArchived: false,
          filters: { clientId: [KAIROS] },
        }),
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        total: 3,
        items: [
          { invoiceNumber: "KAI-0001" },
          { invoiceNumber: "KAI-0002" },
          { invoiceNumber: "KAI-0003" },
        ],
      },
    });

    const descending = await listInvoicesAction(
      invoiceFilterOf(
        listQuery({
          page: 1,
          pageSize: 25,
          sort: "invoiceNumber:desc",
          includeArchived: false,
          filters: { clientId: [KAIROS] },
        }),
      ),
    );
    expect(descending.ok ? descending.data.items.map((row) => row.invoiceNumber) : []).toEqual([
      "KAI-0003",
      "KAI-0002",
      "KAI-0001",
    ]);
  });

  it("filters by status, currency and search through the module filter", async () => {
    signInAs("OWNER");
    const overdue = await listInvoicesAction(
      invoiceFilterOf(
        listQuery({
          page: 1,
          pageSize: 25,
          includeArchived: false,
          filters: { status: ["VENCIDA"], currency: ["USD"] },
        }),
      ),
    );
    expect(overdue).toMatchObject({
      ok: true,
      data: { total: 1, items: [{ invoiceNumber: "KAI-0003", status: "VENCIDA" }] },
    });

    const found = await listInvoicesAction(
      invoiceFilterOf(
        listQuery({ page: 1, pageSize: 25, q: "ZAF", includeArchived: false, filters: {} }),
      ),
    );
    expect(found.ok ? found.data.items.map((row) => row.invoiceNumber) : []).toEqual(["ZAF-0001"]);
  });

  it("maps the issue-date range facet onto dateFrom / dateTo", () => {
    expect(
      invoiceFilterOf(
        listQuery({
          page: 1,
          pageSize: 25,
          includeArchived: false,
          filters: { issued: ["2026-01-01", "2026-01-31"] },
        }),
      ),
    ).toMatchObject({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
  });

  it("answers FORBIDDEN to roles without the invoice grant, and VALIDATION to a bad filter", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      signInAs(role);
      expect(await listInvoicesAction({ page: 1, pageSize: 25 })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    }
    signInAs("ADMIN");
    expect(await listInvoicesAction({ page: 1, pageSize: 25, sort: "nope:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
