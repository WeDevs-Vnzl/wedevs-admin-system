import { describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";

vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@/lib/api/server", () => server);

import {
  getTechnology,
  listActiveTechnologies,
  listTechnologies,
  technologyFilterFromParams,
} from "./queries";

const technology = {
  id: "tec_next_js",
  name: "Next.js",
  nameEn: null,
  slug: "next-js",
  category: "FRONTEND",
  iconSlug: "nextdotjs",
  color: null,
  active: true,
  usageCount: 2,
};

const page = { items: [technology], total: 1, page: 1, pageSize: 25, pageCount: 1 };

describe("listTechnologies", () => {
  it("reads the catalogue through GET /api/v1/technologies with the table filter", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/technologies": { body: page } });
    server.getServerApi.mockResolvedValue(api);

    await expect(listTechnologies({ q: "next", category: ["FRONTEND"] })).resolves.toMatchObject({
      items: [technology],
      total: 1,
    });
    expect(calls[0]?.path).toBe("/api/v1/technologies");
    expect(calls[0]?.search.get("q")).toBe("next");
    expect(calls[0]?.search.getAll("category")).toEqual(["FRONTEND"]);
  });

  it("throws when the BE answers with an error envelope", async () => {
    const { api } = mockApi({ "GET /api/v1/technologies": errorEnvelope("FORBIDDEN") });
    server.getServerApi.mockResolvedValue(api);

    await expect(listTechnologies()).rejects.toThrow("GET /api/v1/technologies failed with 403");
  });
});

describe("listActiveTechnologies", () => {
  it("reads every active technology by name for the stack picker, in one page", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/technologies": { body: page } });
    server.getServerApi.mockResolvedValue(api);

    await expect(listActiveTechnologies()).resolves.toEqual([technology]);
    expect(calls[0]?.search.get("active")).toBe("true");
    expect(calls[0]?.search.get("pageSize")).toBe("100");
    expect(calls[0]?.search.get("sort")).toBe("name:asc");
  });
});

describe("getTechnology", () => {
  it("reads one technology with its usage count through GET /api/v1/technologies/{id}", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/technologies/{id}": { body: technology } });
    server.getServerApi.mockResolvedValue(api);

    await expect(getTechnology("tec_next_js")).resolves.toMatchObject({ usageCount: 2 });
    expect(calls[0]?.path).toBe("/api/v1/technologies/tec_next_js");
  });
});

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
