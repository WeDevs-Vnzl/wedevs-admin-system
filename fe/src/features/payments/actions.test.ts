import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);

import type { UserRole } from "@/lib/validators/enums";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { listPaymentsAction } from "./actions";
import { paymentFilterOf } from "./components/payment-table-query";

function signInAs(role: UserRole) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: `usr_${role}` }));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("listPaymentsAction", () => {
  it("passes the table facets and the header sort through to the service", async () => {
    signInAs("ADMIN");
    const store = getMockStore();
    const confirmed = store.payments.filter((payment) => payment.status === "CONFIRMADO");
    expect(confirmed.length).toBeGreaterThan(1);

    const result = await listPaymentsAction(
      paymentFilterOf({
        page: 1,
        pageSize: 100,
        sort: "code:asc",
        filters: { status: ["CONFIRMADO"] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(confirmed.length);
    expect(result.data.items.every((row) => row.status === "CONFIRMADO")).toBe(true);
    const codes = result.data.items.map((row) => row.code);
    expect(codes).toEqual([...codes].sort());
  });

  it("maps the date range and the unallocated facet onto the service filter", async () => {
    signInAs("OWNER");
    const store = getMockStore();
    const dates = store.payments.map((payment) => payment.date).sort();
    const from = dates[0] ?? "2000-01-01";
    const to = dates[dates.length - 1] ?? "2100-01-01";

    const result = await listPaymentsAction(
      paymentFilterOf({
        page: 1,
        pageSize: 100,
        filters: { date: [from, to], hasUnallocated: ["true"] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.every((row) => Number(row.unallocated) > 0)).toBe(true);
    expect(result.data.items.every((row) => row.date >= from && row.date <= to)).toBe(true);
  });

  it.each(["MEMBER", "VIEWER"] as const)("refuses a %s with FORBIDDEN", async (role) => {
    signInAs(role);
    expect(await listPaymentsAction({ page: 1, pageSize: 25 })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("rejects an unknown sort field with VALIDATION", async () => {
    signInAs("ADMIN");
    expect(await listPaymentsAction({ page: 1, pageSize: 25, sort: "client:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
