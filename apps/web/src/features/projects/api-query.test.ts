import { describe, expect, it } from "vitest";
import { projectFilterSchema } from "@/lib/validators/projects";
import { toProjectListQuery } from "./api-query";

const parse = (input: Record<string, unknown>) => projectFilterSchema.parse(input);

describe("toProjectListQuery", () => {
  it("maps the defaults to page, pageSize and archived=exclude", () => {
    expect(toProjectListQuery(parse({}))).toEqual({ page: 1, pageSize: 25, archived: "exclude" });
  });

  it("maps every facet of GET /projects, keeping the lists as arrays", () => {
    const query = toProjectListQuery(
      parse({
        q: "kairos",
        sort: "targetEndDate:asc",
        includeArchived: true,
        status: ["EN_CURSO", "PAUSADO"],
        clientId: "cli_1",
        technologyId: ["tec_1"],
        tagId: ["tag_1", "tag_2"],
        deliveryFrom: "2026-10-01",
        deliveryTo: "2026-10-31",
        withoutBillingPlan: true,
      }),
    );
    expect(query).toEqual({
      page: 1,
      pageSize: 25,
      archived: "include",
      q: "kairos",
      sort: "targetEndDate:asc",
      status: ["EN_CURSO", "PAUSADO"],
      clientId: ["cli_1"],
      technologyId: ["tec_1"],
      tagId: ["tag_1", "tag_2"],
      deliveryFrom: "2026-10-01",
      deliveryTo: "2026-10-31",
      withoutBillingPlan: "true",
    });
  });

  it("omits withoutBillingPlan when it is false and drops a sort outside the whitelist", () => {
    const query = toProjectListQuery(parse({ withoutBillingPlan: false, sort: "code:desc" }));
    expect(query).not.toHaveProperty("withoutBillingPlan");
    expect(query.sort).toBe("code:desc");
    const bad = { ...parse({}), sort: "nope:asc" };
    expect(toProjectListQuery(bad)).not.toHaveProperty("sort");
  });
});
