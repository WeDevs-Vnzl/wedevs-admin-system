import { describe, expect, it } from "vitest";
import { activityFilterSchema } from "@/lib/validators/activity";
import { activityListQuery, activityOverviewQuery } from "./query-params";

describe("activityListQuery", () => {
  it("sends the paging, the sort and the search as flat query params", () => {
    const filter = activityFilterSchema.parse({
      page: 3,
      pageSize: 50,
      sort: "action:asc",
      q: " ana ",
    });
    expect(activityListQuery(filter)).toEqual({
      page: 3,
      pageSize: 50,
      sort: "action:asc",
      q: "ana",
    });
  });

  it("sends each facet as a list of values (repeated keys on the wire)", () => {
    const filter = activityFilterSchema.parse({
      actorId: ["usr_ana", "usr_luis"],
      actorType: ["USER", "SYSTEM"],
      action: "UPDATE",
      entityType: ["CLIENT"],
    });
    expect(activityListQuery(filter)).toMatchObject({
      actorId: ["usr_ana", "usr_luis"],
      actorType: ["USER", "SYSTEM"],
      action: ["UPDATE"],
      entityType: ["CLIENT"],
    });
  });

  it("sends the date range as the from and to days, and the record as entityType + entityId", () => {
    const filter = activityFilterSchema.parse({
      from: "2026-10-01",
      to: "2026-10-09",
      entityType: "PROJECT",
      entityId: "prj_portal",
    });
    expect(activityListQuery(filter)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-09",
      entityType: ["PROJECT"],
      entityId: "prj_portal",
    });
  });

  it("omits the facets that are not set, and never sends an archived flag", () => {
    const query = activityListQuery(activityFilterSchema.parse({}));
    expect(Object.keys(query).sort()).toEqual(["page", "pageSize"]);
    expect(query).not.toHaveProperty("archived");
  });
});

describe("activityOverviewQuery", () => {
  it("carries the table filters only, so the figures match the rows of the table", () => {
    const filter = activityFilterSchema.parse({
      page: 4,
      pageSize: 100,
      sort: "createdAt:asc",
      actorType: "USER",
      from: "2026-10-01",
    });
    expect(activityOverviewQuery(filter)).toEqual({
      actorType: ["USER"],
      from: "2026-10-01",
    });
  });
});
