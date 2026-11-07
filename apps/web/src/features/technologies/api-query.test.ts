import { describe, expect, it } from "vitest";
import { technologyFilterSchema } from "@/lib/validators/technologies";
import { toTechnologyListQuery } from "./api-query";

describe("toTechnologyListQuery", () => {
  it("maps the table query to the list parameters of GET /api/v1/technologies", () => {
    expect(
      toTechnologyListQuery(
        technologyFilterSchema.parse({
          page: 2,
          pageSize: 50,
          sort: "usageCount:desc",
          q: "ne",
          category: "FRONTEND",
          active: "false",
        }),
      ),
    ).toEqual({
      page: 2,
      pageSize: 50,
      archived: "exclude",
      sort: "usageCount:desc",
      q: "ne",
      category: ["FRONTEND"],
      active: "false",
    });
  });

  it("asks for archived records only when the table includes them", () => {
    expect(
      toTechnologyListQuery(technologyFilterSchema.parse({ includeArchived: true })),
    ).toMatchObject({ archived: "include" });
  });

  it("leaves out the parts the table did not set", () => {
    expect(toTechnologyListQuery(technologyFilterSchema.parse({}))).toEqual({
      page: 1,
      pageSize: 25,
      archived: "exclude",
    });
  });
});
