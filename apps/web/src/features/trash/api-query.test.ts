import { describe, expect, it } from "vitest";
import { toTrashListQuery } from "./api-query";

describe("toTrashListQuery (api-contract §3)", () => {
  it("maps the page, the size, the sort and the search as flat query keys", () => {
    expect(toTrashListQuery({ page: 2, pageSize: 50, sort: "label:asc", q: "veredas" })).toEqual({
      page: 2,
      pageSize: 50,
      sort: "label:asc",
      q: "veredas",
    });
  });

  it("sends the type and the archive date facets with the names the BE reads", () => {
    expect(
      toTrashListQuery({
        entityType: ["CLIENT", "PROJECT"],
        deletedById: ["usr_camila_torres"],
        deletedFrom: "2026-10-01",
        deletedTo: "2026-10-31",
      }),
    ).toEqual({
      entityType: ["CLIENT", "PROJECT"],
      deletedById: ["usr_camila_torres"],
      deletedFrom: "2026-10-01",
      deletedTo: "2026-10-31",
    });
  });

  it("never sends archived: the trash lists archived rows only", () => {
    expect(toTrashListQuery({ page: 1, pageSize: 25 })).not.toHaveProperty("archived");
  });

  it("omits the keys the screen did not set", () => {
    expect(toTrashListQuery({})).toEqual({});
  });
});
