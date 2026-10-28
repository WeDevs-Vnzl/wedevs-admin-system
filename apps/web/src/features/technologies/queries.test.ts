import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { technologyFilterFromParams } from "./queries";

describe("technologyFilterFromParams", () => {
  it("reads the table's URL keys into a technology filter", () => {
    expect(
      technologyFilterFromParams({
        page: "2",
        pageSize: "50",
        sort: "name:desc",
        q: "ne",
        filters: JSON.stringify({ category: ["IA"], active: "true" }),
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 50,
      sort: "name:desc",
      q: "ne",
      category: ["IA"],
      active: true,
    });
  });

  it("falls back to the first page with no filters for an empty URL", () => {
    expect(technologyFilterFromParams({})).toMatchObject({ page: 1, pageSize: 25 });
  });

  it("drops invalid parts one by one instead of failing", () => {
    const filter = technologyFilterFromParams({
      page: "-3",
      pageSize: "7",
      sort: "notAField:asc",
      filters: "{not json",
    });
    expect(filter).toMatchObject({ page: 1, pageSize: 25 });
    expect(filter.sort).toBeUndefined();
    expect(filter.category).toBeUndefined();
  });
});
