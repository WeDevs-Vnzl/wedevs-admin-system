import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/mocks/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mocks/session")>()),
  getMockSessionUser: session.getMockSessionUser,
}));

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { resetMockDataAction, setMockRoleAction } from "./actions";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockReset();
  jar.set.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("setMockRoleAction", () => {
  it("writes the role cookie and refreshes the app", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    expect(await setMockRoleAction({ role: "VIEWER" })).toEqual({
      ok: true,
      data: { role: "VIEWER" },
    });
    expect(jar.set).toHaveBeenCalledWith("wd_mock_role", "VIEWER", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("stays open to a Viewer, so whoever views as Viewer can switch back", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await setMockRoleAction({ role: "OWNER" })).toMatchObject({ ok: true });
    expect(jar.set).toHaveBeenCalledWith("wd_mock_role", "OWNER", expect.any(Object));
  });

  it("rejects a value that is not a role and writes nothing", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    expect(await setMockRoleAction({ role: "ROOT" } as never)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await setMockRoleAction({ role: "ADMIN" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe("resetMockDataAction", () => {
  it("rebuilds the store and refreshes the app", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const store = getMockStore();
    store.tags.length = 0;
    const result = await resetMockDataAction({});
    expect(result).toMatchObject({ ok: true, data: { resetAt: expect.any(String) } });
    expect(store.tags.length).toBeGreaterThan(0);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await resetMockDataAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
