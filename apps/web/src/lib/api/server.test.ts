import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getToken: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
// React's per-request `cache` only memoizes inside a render; emulate it with a one-slot memo.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
    let hit: ReturnType<T> | undefined;
    return ((...args: Parameters<T>) => (hit ??= fn(...args) as ReturnType<T>)) as T;
  },
}));

describe("getServerApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
    mocks.auth.mockReset();
    mocks.getToken.mockReset();
    mocks.auth.mockResolvedValue({ getToken: mocks.getToken });
  });

  it("sends the Clerk server token as a Bearer header", async () => {
    mocks.getToken.mockResolvedValue("server-tok");
    const seen: Request[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(input as Request);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const { getServerApi } = await import("./server");
      const api = await getServerApi();
      await api.GET("/api/v1/health" as never);
    } finally {
      globalThis.fetch = original;
    }
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer server-tok");
  });

  it("is memoized: one client and one auth() call per request", async () => {
    const { getServerApi } = await import("./server");
    const a = await getServerApi();
    const b = await getServerApi();
    expect(a).toBe(b);
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });
});
