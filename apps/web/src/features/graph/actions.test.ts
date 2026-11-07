import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { GRAPH_NODE_TYPE_VALUES } from "@/lib/validators/graph";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { expandNodeAction, getEntityGraphAction, getGlobalGraphAction } from "./actions";

// MOCK — test fixture (no real data): a one-node graph answered by the HTTP test double.
const GRAPH_BODY = {
  nodes: [
    {
      id: "CLIENT:cli_kairos",
      type: "CLIENT",
      entityId: "cli_kairos",
      label: "Kairos Studio",
      code: "CLI-0001",
      meta: {},
      archived: false,
      degree: 0,
    },
  ],
  edges: [],
  truncated: [],
};

function serve(routes: RouteTable) {
  const api = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(api.api);
  return api;
}

beforeEach(() => {
  mocks.getServerApi.mockReset();
});

describe("getEntityGraphAction (GET /api/v1/graph/{type}/{id})", () => {
  it("reads the root at depth 1 with every requested type and returns the graph", async () => {
    const api = serve({ "GET /api/v1/graph/{type}/{id}": { status: 200, body: GRAPH_BODY } });
    const result = await getEntityGraphAction({
      type: "CLIENT",
      id: "cli_kairos",
      include: [...GRAPH_NODE_TYPE_VALUES],
    });

    expect(result).toEqual({ ok: true, data: GRAPH_BODY });
    const [call] = api.calls;
    expect(call?.path).toBe("/api/v1/graph/CLIENT/cli_kairos");
    expect(call?.search.get("depth")).toBe("1");
    expect(call?.search.getAll("include")).toEqual([...GRAPH_NODE_TYPE_VALUES]);
    expect(call?.search.has("includeArchived")).toBe(false);
  });

  it("sends includeArchived as the string the contract types, true or false", async () => {
    const api = serve({ "GET /api/v1/graph/{type}/{id}": { status: 200, body: GRAPH_BODY } });
    await getEntityGraphAction({ type: "CLIENT", id: "cli_kairos", includeArchived: true });
    await getEntityGraphAction({ type: "CLIENT", id: "cli_kairos", includeArchived: false });

    expect(api.calls.map((call) => call.search.get("includeArchived"))).toEqual(["true", "false"]);
  });

  it("maps NOT_FOUND to an ActionResult error (the page decides what to show)", async () => {
    serve({ "GET /api/v1/graph/{type}/{id}": errorEnvelope("NOT_FOUND") });
    const result = await getEntityGraphAction({ type: "CLIENT", id: "cli_missing" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "common.errors.NOT_FOUND" },
    });
  });

  it("maps FORBIDDEN and a network failure without throwing", async () => {
    serve({ "GET /api/v1/graph/{type}/{id}": errorEnvelope("FORBIDDEN") });
    expect(await getEntityGraphAction({ type: "PAYMENT", id: "pay_1" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });

    mocks.getServerApi.mockRejectedValue(new TypeError("fetch failed"));
    expect(await getEntityGraphAction({ type: "PAYMENT", id: "pay_1" })).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
  });
});

describe("expandNodeAction (GET /api/v1/graph/nodes/{nodeId}/neighbours)", () => {
  it("reads one page of a node's neighbours, with the cursor of the '+N más' node", async () => {
    const api = serve({
      "GET /api/v1/graph/nodes/{nodeId}/neighbours": { status: 200, body: GRAPH_BODY },
    });
    const result = await expandNodeAction({
      nodeId: "PROJECT:pry_kairos_web",
      cursor: "cur_page_2",
      include: ["CONTACT", "DOCUMENT"],
      includeArchived: true,
    });

    expect(result.ok).toBe(true);
    const [call] = api.calls;
    expect(call?.path).toBe("/api/v1/graph/nodes/PROJECT%3Apry_kairos_web/neighbours");
    expect(call?.search.get("cursor")).toBe("cur_page_2");
    expect(call?.search.getAll("include")).toEqual(["CONTACT", "DOCUMENT"]);
    expect(call?.search.get("includeArchived")).toBe("true");
  });

  it("omits cursor on the first page and maps a VALIDATION envelope", async () => {
    const api = serve({
      "GET /api/v1/graph/nodes/{nodeId}/neighbours": errorEnvelope("VALIDATION", {
        fieldErrors: { cursor: ["validation.cursor.invalid"] },
      }),
    });
    const result = await expandNodeAction({ nodeId: "CLIENT:cli_kairos" });

    expect(api.calls[0]?.search.has("cursor")).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { cursor: ["validation.cursor.invalid"] } },
    });
  });
});

describe("getGlobalGraphAction (GET /api/v1/graph)", () => {
  it("sends the type list and the filters as flat query params", async () => {
    const api = serve({ "GET /api/v1/graph": { status: 200, body: GRAPH_BODY } });
    const result = await getGlobalGraphAction({
      include: ["CLIENT", "INVOICE"],
      filters: {
        tagIds: ["tag_prioritario"],
        dateFrom: "2026-01-01",
        onlyActive: true,
        includeArchived: false,
      },
    });

    expect(result.ok).toBe(true);
    const [call] = api.calls;
    expect(call?.path).toBe("/api/v1/graph");
    expect(call?.search.getAll("include")).toEqual(["CLIENT", "INVOICE"]);
    expect(call?.search.getAll("tagIds")).toEqual(["tag_prioritario"]);
    expect(call?.search.get("dateFrom")).toBe("2026-01-01");
    expect(call?.search.has("dateTo")).toBe(false);
    expect(call?.search.has("technologyIds")).toBe(false);
    expect(call?.search.get("onlyActive")).toBe("true");
    expect(call?.search.get("includeArchived")).toBe("false");
  });

  it("maps an INTERNAL envelope to an ActionResult error with a correlation id", async () => {
    serve({
      "GET /api/v1/graph": errorEnvelope("INTERNAL", { correlationId: "corr_graph_1" }),
    });
    const result = await getGlobalGraphAction({
      filters: { onlyActive: false, includeArchived: false },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "common.errors.INTERNAL", correlationId: "corr_graph_1" },
    });
  });
});
