import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { searchGlobalAction } from "./actions";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("searchGlobalAction", () => {
  it("returns the exact code match alone (HU-26 CA3)", async () => {
    const invoice = getMockStore().invoices.find((row) => row.code === "FAC-0003")!;
    const result = await searchGlobalAction({ q: "fac-0003" });
    expect(result).toMatchObject({
      ok: true,
      data: { groups: [{ entityType: "INVOICE", items: [{ entityId: invoice.id }] }] },
    });
  });

  it("applies the prefix: `c:` returns clients only", async () => {
    const client = getMockStore().clients.find((row) => !row.archivedAt)!;
    const result = await searchGlobalAction({ q: `c: ${client.tradeName}` });
    expect(result.ok && result.data.entityType).toBe("CLIENT");
    expect(result.ok && result.data.groups.map((group) => group.entityType)).toEqual(["CLIENT"]);
  });

  it("any signed-in role may search; an empty query is a VALIDATION error", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await searchGlobalAction({ q: "a" })).toMatchObject({ ok: true });
    expect(await searchGlobalAction({ q: " " })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
