import { describe, expect, it } from "vitest";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { createLoader } from "nuqs/server";
import { toProjectFilter } from "./table-filter";

const load = createLoader(tableUrlParsers);

/** The server page's path: URL → loader → list query → project filter. */
function filterOf(search: string) {
  return toProjectFilter(urlStateToListQuery(load(new URLSearchParams(search))));
}

describe("toProjectFilter (URL state of /projects/list)", () => {
  it("reads ?archived into includeArchived", () => {
    expect(filterOf("archived=true").includeArchived).toBe(true);
    expect(filterOf("").includeArchived).toBe(false);
  });

  it("caps q at 200 characters instead of rejecting the query", () => {
    expect(filterOf(`q=${"a".repeat(300)}`).q).toHaveLength(200);
  });

  it("flattens the facets and keeps the delivery window", () => {
    const filters = JSON.stringify({
      status: ["EN_CURSO"],
      delivery: ["2026-01-01", "2026-12-31"],
    });
    const filter = filterOf(`filters=${encodeURIComponent(filters)}`);
    expect(filter.status).toEqual(["EN_CURSO"]);
    expect(filter.deliveryFrom).toBe("2026-01-01");
    expect(filter.deliveryTo).toBe("2026-12-31");
  });

  it("drops a bad part without resetting the rest of the query", () => {
    const filter = filterOf(
      "page=3&pageSize=50&sort=code:asc&q=kairos&archived=true&filters=%7Bnot-json",
    );
    expect(filter).toMatchObject({
      page: 3,
      pageSize: 50,
      sort: "code:asc",
      q: "kairos",
      includeArchived: true,
    });
  });

  it("keeps search and paging when a facet value is invalid", () => {
    const filters = JSON.stringify({ status: ["NOPE"] });
    const filter = filterOf(`q=kairos&page=2&filters=${encodeURIComponent(filters)}`);
    expect(filter).toMatchObject({ q: "kairos", page: 2 });
    expect(filter.status).toBeUndefined();
  });
});
