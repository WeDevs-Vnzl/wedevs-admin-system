import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("next/cache", () => cache);

import { tableColumnsKey } from "@/lib/validators/preferences";
import { makeSessionUser } from "@/mocks/test-helpers";
import { resetPreferenceAction, setPreferenceAction } from "./actions";
import { getPreferences } from "./queries";

const layout = ["/", "layout"];

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockReset();
  cache.updateTag.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("preferences actions and query", () => {
  it.each(["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const)(
    "a %s changes their own theme",
    async (role) => {
      session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
      const result = await setPreferenceAction({ key: "theme", value: "dark" });
      expect(result).toMatchObject({ ok: true, data: { theme: "dark" } });
      expect((await getPreferences()).theme).toBe("dark");
      expect(cache.revalidatePath).toHaveBeenCalledWith(...layout);
    },
  );

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await setPreferenceAction({ key: "theme", value: "dark" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(await resetPreferenceAction({ key: "theme" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("rejects a value the key does not accept", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    expect(await setPreferenceAction({ key: "theme", value: "neon" } as never)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(
      await setPreferenceAction({ key: "timezone", value: "Mars/Olympus" } as never),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("stores a column layout without refreshing the whole app", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const key = tableColumnsKey("clients") as never;
    const columns = { order: ["name"], visibility: { status: false }, widths: {} };
    const stored = await setPreferenceAction({ key, value: columns });
    expect(stored).toMatchObject({ ok: true, data: { tableColumns: { clients: columns } } });
    expect((await getPreferences()).tableColumns.clients).toEqual(columns);
    expect(cache.revalidatePath).not.toHaveBeenCalled();

    const reset = await resetPreferenceAction({ key });
    expect(reset).toMatchObject({ ok: true, data: { tableColumns: {} } });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("resetting the theme refreshes the app and restores the default", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { theme: "light" }));
    await setPreferenceAction({ key: "theme", value: "dark" });
    cache.revalidatePath.mockClear();
    const result = await resetPreferenceAction({ key: "theme" });
    expect(result).toMatchObject({ ok: true, data: { theme: "light" } });
    expect(cache.revalidatePath).toHaveBeenCalledWith(...layout);
  });

  it("keeps each user's preferences apart", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { id: "usr_a" }));
    await setPreferenceAction({ key: "theme", value: "dark" });
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { id: "usr_b" }));
    expect((await getPreferences()).theme).toBe("system");
  });
});
