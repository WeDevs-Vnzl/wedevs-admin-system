import { describe, expect, it } from "vitest";
import { tagFilterSchema } from "@/lib/validators/tags";
import { toTagListQuery } from "./api-query";

describe("toTagListQuery", () => {
  it("maps the table query to the list parameters of GET /api/v1/tags", () => {
    expect(
      toTagListQuery(
        tagFilterSchema.parse({
          page: 2,
          pageSize: 50,
          sort: "usageCount:desc",
          q: "ur",
          entityType: "PROJECT",
        }),
      ),
    ).toEqual({
      page: 2,
      pageSize: 50,
      archived: "exclude",
      sort: "usageCount:desc",
      q: "ur",
      entityType: ["PROJECT"],
    });
  });

  it("asks for archived records only when the table includes them", () => {
    expect(toTagListQuery(tagFilterSchema.parse({ includeArchived: true }))).toMatchObject({
      archived: "include",
    });
  });

  it("leaves out the parts the table did not set", () => {
    expect(toTagListQuery(tagFilterSchema.parse({}))).toEqual({
      page: 1,
      pageSize: 25,
      archived: "exclude",
    });
  });
});
