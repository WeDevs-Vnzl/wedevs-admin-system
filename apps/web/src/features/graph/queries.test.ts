import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { GLOBAL_GRAPH_DEFAULT_TYPES, GRAPH_NODE_TYPE_VALUES } from "@/lib/validators/graph";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { getEntityGraph, getGlobalGraph } from "./queries";

// MOCK — test fixture (no real data): an empty graph answered by the HTTP test double.
const EMPTY_GRAPH = { nodes: [], edges: [], truncated: [] };

function serve(routes: RouteTable) {
  const api = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(api.api);
  return api;
}

beforeEach(() => {
  mocks.getServerApi.mockReset();
});

describe("getEntityGraph (RSC read of the detail graph)", () => {
  it("reads the root at depth 1 with every node type and returns the graph", async () => {
    const api = serve({ "GET /api/v1/graph/{type}/{id}": { status: 200, body: EMPTY_GRAPH } });
    const result = await getEntityGraph("PROJECT", "pry_kairos_web");

    expect(result).toEqual({ ok: true, data: EMPTY_GRAPH });
    const [call] = api.calls;
    expect(call?.path).toBe("/api/v1/graph/PROJECT/pry_kairos_web");
    expect(call?.search.get("depth")).toBe("1");
    expect(call?.search.getAll("include")).toEqual([...GRAPH_NODE_TYPE_VALUES]);
  });

  it("returns NOT_FOUND as a result, so the page can answer the not-found state", async () => {
    serve({ "GET /api/v1/graph/{type}/{id}": errorEnvelope("NOT_FOUND") });
    const result = await getEntityGraph("CLIENT", "cli_missing");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("getGlobalGraph (RSC read of the global graph)", () => {
  it("reads clients, projects and documents with no filters by default", async () => {
    const api = serve({ "GET /api/v1/graph": { status: 200, body: EMPTY_GRAPH } });
    const result = await getGlobalGraph();

    expect(result).toEqual({ ok: true, data: EMPTY_GRAPH });
    const [call] = api.calls;
    expect(call?.path).toBe("/api/v1/graph");
    expect(call?.search.getAll("include")).toEqual([...GLOBAL_GRAPH_DEFAULT_TYPES]);
    expect(call?.search.get("onlyActive")).toBe("false");
    expect(call?.search.get("includeArchived")).toBe("false");
  });
});
