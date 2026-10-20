import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);

import type { UserRole } from "@/lib/validators/enums";
import { listQuerySchema } from "@/lib/validators/common";
import { makeSessionUser } from "@/mocks/test-helpers";
import { listAccountsAction } from "./actions";
import { accountFilterOf } from "./components/account-table-query";

function signInAs(role: UserRole) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: `usr_${role}` }));
}

/** The filter the table sends for a URL state (facets nested under `filters`, as `useTableUrlState` gives). */
const tableFilter = (input: Record<string, unknown>) =>
  accountFilterOf(listQuerySchema.parse(input));

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("listAccountsAction", () => {
  it("passes the type and currency facets and the sort to the service", async () => {
    signInAs("ADMIN");
    const result = await listAccountsAction(
      tableFilter({ filters: { currency: ["VES"] }, sort: "name:desc" }),
    );
    expect(result).toMatchObject({ ok: true, data: { total: 2 } });
    if (!result.ok) return;
    expect(result.data.items.map((account) => account.id)).toEqual([
      "acc_caja_ves",
      "acc_banco_ves",
    ]);

    const byType = await listAccountsAction(tableFilter({ filters: { type: ["WALLET_CRIPTO"] } }));
    expect(byType).toMatchObject({ ok: true, data: { total: 1, items: [{ id: "acc_binance" }] } });
  });

  it("filters by status and searches by name", async () => {
    signInAs("OWNER");
    expect(
      await listAccountsAction(tableFilter({ filters: { status: ["inactive"] } })),
    ).toMatchObject({ ok: true, data: { total: 0 } });
    expect(await listAccountsAction(tableFilter({ q: "binance" }))).toMatchObject({
      ok: true,
      data: { total: 1, items: [{ id: "acc_binance" }] },
    });
  });

  it("rejects roles without the account read grant and a bad sort", async () => {
    signInAs("MEMBER");
    expect(await listAccountsAction(tableFilter({}))).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    signInAs("ADMIN");
    expect(await listAccountsAction({ sort: "holderName:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
