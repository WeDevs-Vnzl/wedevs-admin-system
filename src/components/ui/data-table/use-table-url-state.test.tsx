import { act, renderHook, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import { useTableUrlState } from "./use-table-url-state";

describe("useTableUrlState", () => {
  it("reads a valid query from the URL", () => {
    const { result } = renderHook(() => useTableUrlState(), {
      wrapper: withNuqsTestingAdapter({ searchParams: "?page=2&pageSize=50&sort=name:asc&q=acme" }),
    });

    expect(result.current.query).toMatchObject({ page: 2, pageSize: 50, sort: "name:asc", q: "acme" });
  });

  it("falls back to 25 rows for a page size outside the allowed values", () => {
    const { result } = renderHook(() => useTableUrlState(), {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pageSize=10" }),
    });

    expect(result.current.query.pageSize).toBe(25);
  });

  it("writes a patch to the URL and resets the page on a search change", async () => {
    const onUrlUpdate = vi.fn();
    const { result } = renderHook(() => useTableUrlState(), {
      wrapper: withNuqsTestingAdapter({ searchParams: "?page=3", hasMemory: true, onUrlUpdate }),
    });

    act(() => result.current.setQuery({ q: "acme" }));

    await waitFor(() => {
      expect(result.current.query.q).toBe("acme");
    });
    expect(result.current.query.page).toBe(1);
    const last = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(last?.searchParams.get("q")).toBe("acme");
    expect(last?.searchParams.get("page")).toBeNull();
  });
});
