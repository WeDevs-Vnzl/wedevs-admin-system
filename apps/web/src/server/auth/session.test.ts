import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getServerApi: vi.fn() }));
// React's per-request `cache` only memoizes inside a render; emulate it with a slot the tests reset.
const memo = vi.hoisted(() => ({ slot: undefined as { value: unknown } | undefined }));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
// next/navigation's redirect throws NEXT_REDIRECT; the stub throws an Error carrying the target URL.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: Parameters<T>) => (memo.slot ??= { value: fn(...args) }).value) as T,
}));

import { UnauthenticatedError, getSessionUser, requireSessionUser, toSessionUser } from "./session";

/** A `GET /api/v1/me` 200 body as the generated `UserDetailDto` types it. */
const meBody = {
  id: "usr_ana",
  name: "Ana Pérez",
  email: "ana.perez@example.com",
  imageUrl: null,
  role: "ADMIN",
  locale: "en",
  theme: "dark",
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
} as const;

const signedInClerk = { userId: "user_clerk_ana", getToken: async () => "clerk-token" };

function serveMe(routes: RouteTable) {
  const api = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(api.api);
  return api;
}

beforeEach(() => {
  memo.slot = undefined;
  mocks.auth.mockReset();
  mocks.getServerApi.mockReset();
});

describe("getSessionUser (GET /api/v1/me)", () => {
  it("is null without a Clerk session and never calls the BE", async () => {
    mocks.auth.mockResolvedValue({ userId: null, getToken: async () => null });
    expect(await getSessionUser()).toBeNull();
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });

  it("maps the 200 response of GET /api/v1/me to the session user", async () => {
    mocks.auth.mockResolvedValue(signedInClerk);
    const api = serveMe({ "GET /api/v1/me": { status: 200, body: meBody } });
    expect(await getSessionUser()).toEqual({
      id: "usr_ana",
      name: "Ana Pérez",
      email: "ana.perez@example.com",
      imageUrl: null,
      role: "ADMIN",
      locale: "en",
      theme: "dark",
    });
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /api/v1/me"]);
  });

  it("is null when the BE answers 401 (a Clerk session without a local user, Q-BE1-2)", async () => {
    mocks.auth.mockResolvedValue(signedInClerk);
    serveMe({ "GET /api/v1/me": errorEnvelope("UNAUTHENTICATED") });
    expect(await getSessionUser()).toBeNull();
  });

  it("throws on any other failure, so the page renders the INTERNAL state", async () => {
    mocks.auth.mockResolvedValue(signedInClerk);
    serveMe({ "GET /api/v1/me": errorEnvelope("INTERNAL") });
    await expect(getSessionUser()).rejects.toThrow(/GET \/api\/v1\/me failed with 500/);
  });

  it("is memoized per request: one /me call for several reads", async () => {
    mocks.auth.mockResolvedValue(signedInClerk);
    const api = serveMe({ "GET /api/v1/me": { status: 200, body: meBody } });
    const first = await getSessionUser();
    const second = await getSessionUser();
    expect(second).toBe(first);
    expect(api.calls).toHaveLength(1);
  });

  it("takes the role from the BE response, whatever the Clerk session says", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_clerk_ana", publicMetadata: { role: "OWNER" } });
    serveMe({ "GET /api/v1/me": { status: 200, body: { ...meBody, role: "VIEWER" } } });
    expect((await getSessionUser())?.role).toBe("VIEWER");
  });
});

describe("toSessionUser", () => {
  it("keeps a supported locale and theme", () => {
    expect(toSessionUser({ ...meBody, locale: "es", theme: "light" })).toMatchObject({
      locale: "es",
      theme: "light",
    });
  });

  it("falls back to es and system for values the UI does not know", () => {
    expect(toSessionUser({ ...meBody, locale: "fr", theme: "sepia" })).toMatchObject({
      locale: "es",
      theme: "system",
    });
  });
});

describe("requireSessionUser", () => {
  it("returns the user", async () => {
    mocks.auth.mockResolvedValue(signedInClerk);
    serveMe({ "GET /api/v1/me": { status: 200, body: meBody } });
    expect((await requireSessionUser()).id).toBe("usr_ana");
  });

  it("throws UnauthenticatedError (code UNAUTHENTICATED) without a Clerk session, with no BE call", async () => {
    mocks.auth.mockResolvedValue({ userId: null, getToken: async () => null });
    const api = serveMe({ "GET /api/v1/me": { status: 200, body: meBody } });
    const error = await requireSessionUser().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe("UNAUTHENTICATED");
    expect(api.calls).toHaveLength(0);
  });

  it("redirects to /sign-in?reason=no-access when the Clerk session has no local user (BE 401)", async () => {
    mocks.auth.mockResolvedValue(signedInClerk);
    serveMe({ "GET /api/v1/me": errorEnvelope("UNAUTHENTICATED") });
    await expect(requireSessionUser()).rejects.toThrow("NEXT_REDIRECT:/sign-in?reason=no-access");
  });
});
