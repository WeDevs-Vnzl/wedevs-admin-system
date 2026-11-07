import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteHandler } from "@/lib/api/testing";
import { useGlobalSearch } from "./use-global-search";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: async () => "test-token" }) }));

// MOCK — HTTP fixtures: the answers the BE would send; the hook under test only calls and maps them.
function stubSearchApi(handler: RouteHandler) {
  const http = mockApi({ "GET /api/v1/search": handler });
  vi.stubGlobal("fetch", http.fetch);
  return http;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useGlobalSearch", () => {
  it("does not call the API for an empty query or a prefix alone", async () => {
    const http = stubSearchApi({ body: { query: "", entityType: null, groups: [] } });

    const { result } = renderHook(() => useGlobalSearch("c:", false));
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));

    expect(result.current).toEqual({ status: "idle" });
    expect(http.calls).toHaveLength(0);
  });

  it("sends one debounced request with the typed text, prefix included", async () => {
    const http = stubSearchApi({
      body: { query: "garcia", entityType: "CLIENT", groups: [] },
    });

    const { result } = renderHook(() => useGlobalSearch("c: garcia", false));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.path).toBe("/api/v1/search");
    expect(http.calls[0]?.search.get("q")).toBe("c: garcia");
  });

  it("reports an error when the API fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubSearchApi(errorEnvelope("INTERNAL"));

    const { result } = renderHook(() => useGlobalSearch("garcia", false));

    await waitFor(() => expect(result.current).toEqual({ status: "error" }));
  });

  it("shows only the answer to the current query, never a slower earlier one", async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    stubSearchApi(async (call) => {
      const q = call.search.get("q") ?? "";
      if (q === "slow") await slow;
      return { body: { query: q, entityType: null, groups: [] } };
    });

    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(q, false), {
      initialProps: { q: "slow" },
    });
    await waitFor(() => expect(result.current.status).toBe("loading"));
    rerender({ q: "fast" });

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "ready",
        results: { query: "fast", entityType: null, groups: [] },
      }),
    );
    await act(async () => {
      releaseSlow();
      await slow;
    });
    expect(result.current).toEqual({
      status: "ready",
      results: { query: "fast", entityType: null, groups: [] },
    });
  });

  it("asks the API for archived records only when the caller asks (HU-28 CA1)", async () => {
    const http = stubSearchApi({ body: { query: "garcia", entityType: null, groups: [] } });

    const { result, rerender } = renderHook(
      ({ archived }) => useGlobalSearch("garcia", archived),
      { initialProps: { archived: false } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(http.calls[0]?.search.has("includeArchived")).toBe(false);

    rerender({ archived: true });

    await waitFor(() => expect(http.calls).toHaveLength(2));
    expect(http.calls[1]?.search.get("includeArchived")).toBe("true");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
