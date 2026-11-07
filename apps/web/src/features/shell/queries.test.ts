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

import { getShellData } from "./queries";

const signedInClerk = { userId: "user_clerk_ana", getToken: async () => "clerk-token" };

/** `GET /api/v1/me`, the session seam the shell user comes from. */
const meBody = {
  id: "usr_ana",
  name: "Ana Pérez",
  email: "ana.perez@example.com",
  imageUrl: null,
  role: "OWNER",
  locale: "en",
  theme: "dark",
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
} as const;

/** `GET /api/v1/shell` 200 body as the generated `ShellResponseDto` types it. */
const shellBody = {
  user: { id: "usr_ana", name: "Ana Pérez", email: "ana.perez@example.com", role: "OWNER" },
  alerts: { total: 5, unread: 3, byType: { INVOICE_OVERDUE: 1, MISSING_RATE: 1 } },
  vesRate: { date: "2026-10-09", source: "BCV", usdRate: "755.16000000" },
  vesRateMissing: false,
} as const;

function serve(routes: RouteTable) {
  const api = mockApi({ "GET /api/v1/me": { status: 200, body: meBody }, ...routes });
  mocks.getServerApi.mockResolvedValue(api.api);
  return api;
}

beforeEach(() => {
  memo.slot = undefined;
  mocks.auth.mockReset();
  mocks.getServerApi.mockReset();
  mocks.auth.mockResolvedValue(signedInClerk);
});

describe("getShellData (GET /api/v1/shell)", () => {
  it("maps the shell response: user from the session, VES rate, missing flag and alert totals", async () => {
    const api = serve({ "GET /api/v1/shell": { status: 200, body: shellBody } });
    expect(await getShellData()).toEqual({
      user: {
        id: "usr_ana",
        name: "Ana Pérez",
        email: "ana.perez@example.com",
        imageUrl: null,
        role: "OWNER",
        locale: "en",
        theme: "dark",
      },
      vesRate: { date: "2026-10-09", usdRate: "755.16000000", source: "BCV" },
      vesRateMissing: false,
      alertCount: 5,
      unreadAlertCount: 3,
    });
    expect(api.calls.map((call) => call.path)).toEqual(["/api/v1/me", "/api/v1/shell"]);
  });

  it("maps a rate source the frontend does not know to null and keeps the string rate as returned", async () => {
    serve({
      "GET /api/v1/shell": {
        status: 200,
        body: { ...shellBody, vesRate: { date: "2026-10-09", source: "BINANCE", usdRate: "9.5" } },
      },
    });
    const data = await getShellData();
    expect(data.vesRate).toEqual({ date: "2026-10-09", usdRate: "9.5", source: null });
  });

  it("keeps a null source (no source recorded) as null", async () => {
    serve({
      "GET /api/v1/shell": {
        status: 200,
        body: { ...shellBody, vesRate: { date: "2026-10-09", source: null, usdRate: "9.5" } },
      },
    });
    expect((await getShellData()).vesRate?.source).toBeNull();
  });

  it("passes vesRateMissing through and shows the earlier fallback date as returned", async () => {
    serve({
      "GET /api/v1/shell": {
        status: 200,
        body: {
          ...shellBody,
          vesRate: { date: "2026-10-08", source: "BCV", usdRate: "750.00" },
          vesRateMissing: true,
        },
      },
    });
    const data = await getShellData();
    expect(data.vesRate?.date).toBe("2026-10-08");
    expect(data.vesRateMissing).toBe(true);
  });

  it("reports no rate at all as a null rate with the missing flag as returned", async () => {
    serve({
      "GET /api/v1/shell": {
        status: 200,
        body: { ...shellBody, vesRate: null, vesRateMissing: true },
      },
    });
    const data = await getShellData();
    expect(data.vesRate).toBeNull();
    expect(data.vesRateMissing).toBe(true);
  });

  it("throws when the shell request fails, so the layout error boundary shows the failure", async () => {
    serve({ "GET /api/v1/shell": errorEnvelope("INTERNAL") });
    await expect(getShellData()).rejects.toThrow("GET /api/v1/shell failed with 500");
  });

  it("throws UNAUTHENTICATED when nobody is signed in and never calls the BE", async () => {
    mocks.auth.mockResolvedValue({ userId: null, getToken: async () => null });
    await expect(getShellData()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });
});
