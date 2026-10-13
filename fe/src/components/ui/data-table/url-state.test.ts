import { describe, expect, it } from "vitest";
import { listQuerySchema } from "@/lib/validators/common";
import {
  guardPageSize,
  listQueryToUrlState,
  patchToUrlState,
  urlStateToListQuery,
} from "./use-table-url-state";

describe("guardPageSize", () => {
  it("accepts the three allowed sizes, as numbers or strings", () => {
    expect(guardPageSize(25)).toBe(25);
    expect(guardPageSize(50)).toBe(50);
    expect(guardPageSize("100")).toBe(100);
  });

  it("falls back to 25 for any other size", () => {
    expect(guardPageSize(10)).toBe(25);
    expect(guardPageSize(75)).toBe(25);
    expect(guardPageSize("abc")).toBe(25);
    expect(guardPageSize(undefined)).toBe(25);
    expect(guardPageSize(null)).toBe(25);
  });
});

describe("URL state round trip", () => {
  it("round-trips a fully populated list query through the URL state", () => {
    const query = listQuerySchema.parse({
      page: 3,
      pageSize: 50,
      sort: "client.name:desc",
      q: "acme",
      includeArchived: true,
      filters: {
        status: ["active", "paused"],
        range: ["2026-01-01", "2026-01-31"],
        owner: "u-1",
      },
    });

    const state = listQueryToUrlState(query);
    expect(urlStateToListQuery(state)).toEqual(query);
  });

  it("round-trips the defaults, with unset values as null in the URL state", () => {
    const query = listQuerySchema.parse({});
    const state = listQueryToUrlState(query);

    expect(state).toEqual({
      page: 1,
      pageSize: 25,
      sort: null,
      q: null,
      archived: false,
      filters: {},
    });
    expect(urlStateToListQuery(state)).toEqual(query);
  });

  it("drops invalid parts one by one instead of rejecting the whole URL", () => {
    const query = urlStateToListQuery({
      page: 0,
      pageSize: 10,
      sort: "not a sort",
      q: "x".repeat(300),
      archived: true,
      filters: "not-an-object" as unknown as Record<string, string>,
    });

    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(25);
    expect(query.sort).toBeUndefined();
    expect(query.q).toHaveLength(200);
    expect(query.includeArchived).toBe(true);
    expect(query.filters).toEqual({});
    expect(listQuerySchema.safeParse(query).success).toBe(true);
  });

  it("returns to page 1 on any patch that does not name a page", () => {
    const current = listQuerySchema.parse({ page: 4, pageSize: 25, q: "old" });

    expect(patchToUrlState(current, { q: "new" }).page).toBe(1);
    expect(patchToUrlState(current, { pageSize: 50 }).page).toBe(1);
    expect(patchToUrlState(current, { page: 2 }).page).toBe(2);
  });
});
