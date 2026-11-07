import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ api: undefined as unknown }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const nav = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => nav);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => holder.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { tableColumnsKey } from "@/lib/validators/preferences";
import { resetPreferenceAction, setPreferenceAction } from "./actions";
import { getPreferences } from "./queries";

const stored = {
  locale: "es",
  theme: "dark",
  timezone: "America/Caracas",
  tableColumns: { clients: { order: ["name"], visibility: { status: false }, widths: {} } },
};

function connect(routes: RouteTable) {
  const mocked = mockApi(routes);
  holder.api = mocked.api;
  return mocked;
}

beforeEach(() => vi.clearAllMocks());

describe("setPreferenceAction (PUT /me/preferences/{key})", () => {
  it("PUTs the value of the key and refreshes the layout for theme", async () => {
    const { calls } = connect({ "PUT /api/v1/me/preferences/{key}": { body: stored } });
    const result = await setPreferenceAction({ key: "theme", value: "dark" });
    expect(result).toMatchObject({ ok: true, data: { theme: "dark" } });
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/api/v1/me/preferences/theme" });
    expect(calls[0]?.body).toEqual({ value: "dark" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["locale", "en"],
    ["timezone", "UTC"],
  ] as const)("stores %s", async (key, value) => {
    const { calls } = connect({ "PUT /api/v1/me/preferences/{key}": { body: stored } });
    await setPreferenceAction({ key, value } as never);
    expect(calls[0]?.path).toBe(`/api/v1/me/preferences/${key}`);
    expect(calls[0]?.body).toEqual({ value });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("stores a column layout under the encoded table key without refreshing the app (HU-27 CA1)", async () => {
    const { calls } = connect({ "PUT /api/v1/me/preferences/{key}": { body: stored } });
    const columns = { order: ["name"], visibility: { status: false }, widths: {} };
    const key = tableColumnsKey("clients") as never;
    const result = await setPreferenceAction({ key, value: columns });
    expect(result).toMatchObject({ ok: true, data: { tableColumns: { clients: columns } } });
    expect(decodeURIComponent(calls[0]!.path)).toBe("/api/v1/me/preferences/table:clients:columns");
    expect(calls[0]?.body).toEqual({ value: columns });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a VALIDATION error and does not refresh", async () => {
    connect({ "PUT /api/v1/me/preferences/{key}": errorEnvelope("VALIDATION") });
    expect(await setPreferenceAction({ key: "theme", value: "neon" } as never)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns UNAUTHENTICATED with the sign-in redirect for a signed-out caller", async () => {
    connect({ "PUT /api/v1/me/preferences/{key}": errorEnvelope("UNAUTHENTICATED") });
    expect(await setPreferenceAction({ key: "theme", value: "dark" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", redirectTo: "/sign-in" },
    });
  });
});

describe("resetPreferenceAction (DELETE /me/preferences/{key})", () => {
  it("DELETEs the key and refreshes the layout for theme", async () => {
    const { calls } = connect({ "DELETE /api/v1/me/preferences/{key}": { body: stored } });
    const result = await resetPreferenceAction({ key: "theme" });
    expect(result).toMatchObject({ ok: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/api/v1/me/preferences/theme" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("restores the default columns without refreshing the app", async () => {
    const { calls } = connect({
      "DELETE /api/v1/me/preferences/{key}": { body: { ...stored, tableColumns: {} } },
    });
    const result = await resetPreferenceAction({ key: tableColumnsKey("clients") as never });
    expect(result).toMatchObject({ ok: true, data: { tableColumns: {} } });
    expect(decodeURIComponent(calls[0]!.path)).toBe("/api/v1/me/preferences/table:clients:columns");
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("getPreferences (GET /me/preferences)", () => {
  it("returns the stored preferences", async () => {
    connect({ "GET /api/v1/me/preferences": { body: stored } });
    expect(await getPreferences()).toEqual(stored);
  });

  it("falls back to the defaults when the read fails, so a table still renders", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    connect({ "GET /api/v1/me/preferences": errorEnvelope("INTERNAL") });
    expect(await getPreferences()).toEqual({
      locale: "es",
      theme: "system",
      timezone: "America/Caracas",
      tableColumns: {},
    });
  });

  it("sends a signed-out caller to sign-in", async () => {
    connect({ "GET /api/v1/me/preferences": errorEnvelope("UNAUTHENTICATED") });
    await expect(getPreferences()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });
});
