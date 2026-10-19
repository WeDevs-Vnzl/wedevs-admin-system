import type { GraphService } from "./graph";
import { describe, expect, it } from "vitest";
import {
  GLOBAL_GRAPH_DEFAULT_TYPES,
  GRAPH_NODE_TYPE_VALUES,
  expandNodeInputSchema,
  getEntityGraphInputSchema,
  getGlobalGraphInputSchema,
  graphEdgeSchema,
  graphNodeId,
  graphNodeSchema,
  graphResponseSchema,
  parseGraphNodeId,
} from "./graph";

const node = {
  id: "CLIENT:cli_1",
  type: "CLIENT",
  entityId: "cli_1",
  label: "Kairos Studio",
  code: "CLI-0001",
  status: "ACTIVO",
  meta: { receivableUsd: "1800.50", projects: 2, website: null },
  archived: false,
  degree: 5,
};

describe("§8.12.5 data contract", () => {
  it("has exactly the eleven node types of the PRD", () => {
    expect([...GRAPH_NODE_TYPE_VALUES]).toEqual([
      "CLIENT",
      "CONTACT",
      "PROJECT",
      "INVOICE",
      "PAYMENT",
      "EXPENSE",
      "ACCOUNT",
      "DOCUMENT",
      "NOTE",
      "TECHNOLOGY",
      "TAG",
    ]);
  });

  it("GraphNode has the PRD fields; code and status are optional", () => {
    expect(graphNodeSchema.safeParse(node).success).toBe(true);
    const { code: _code, status: _status, ...minimal } = node;
    void _code;
    void _status;
    expect(graphNodeSchema.safeParse(minimal).success).toBe(true);
    expect(Object.keys(graphNodeSchema.parse(node)).sort()).toEqual(
      ["archived", "code", "degree", "entityId", "id", "label", "meta", "status", "type"].sort(),
    );
  });

  it("node id must be `${type}:${entityId}`", () => {
    expect(graphNodeSchema.safeParse({ ...node, id: "PROJECT:cli_1" }).success).toBe(false);
    expect(graphNodeSchema.safeParse({ ...node, id: "cli_1" }).success).toBe(false);
    expect(graphNodeId("PROJECT", "pry_1")).toBe("PROJECT:pry_1");
  });

  it("rejects unknown types, negative degree and non-primitive meta", () => {
    expect(graphNodeSchema.safeParse({ ...node, type: "ROBOT" }).success).toBe(false);
    expect(graphNodeSchema.safeParse({ ...node, degree: -1 }).success).toBe(false);
    expect(graphNodeSchema.safeParse({ ...node, meta: { nested: { a: 1 } } }).success).toBe(false);
    expect(graphNodeSchema.safeParse({ ...node, meta: undefined }).success).toBe(false);
  });

  it("GraphEdge and GraphResponse (with truncated)", () => {
    const edge = {
      id: "e1",
      source: "CLIENT:cli_1",
      target: "PROJECT:pry_1",
      relation: "participa",
      label: "Contratante",
    };
    expect(graphEdgeSchema.safeParse(edge).success).toBe(true);
    expect(
      graphEdgeSchema.safeParse({ id: "e1", source: "a", target: "b", relation: "paga" }).success,
    ).toBe(true);
    expect(graphEdgeSchema.safeParse({ id: "e1", source: "a", target: "b" }).success).toBe(false);
    expect(
      graphResponseSchema.safeParse({
        nodes: [node],
        edges: [edge],
        truncated: [{ nodeId: "CLIENT:cli_1", remaining: 12, cursor: "50" }],
      }).success,
    ).toBe(true);
    expect(graphResponseSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
    expect(
      graphResponseSchema.safeParse({
        nodes: [],
        edges: [],
        truncated: [{ nodeId: "x", remaining: 0, cursor: "50" }],
      }).success,
    ).toBe(false);
    expect(
      graphResponseSchema.safeParse({
        nodes: [],
        edges: [],
        truncated: [{ nodeId: "x", remaining: 3 }],
      }).success,
    ).toBe(false);
  });
});

describe("node id helpers", () => {
  it("parses well-formed ids and rejects the rest", () => {
    expect(parseGraphNodeId("DOCUMENT:doc_1")).toEqual({ type: "DOCUMENT", entityId: "doc_1" });
    for (const bad of ["doc_1", ":doc_1", "DOCUMENT:", "ROBOT:x", "DOCUMENT:bad id"]) {
      expect(parseGraphNodeId(bad), bad).toBeNull();
    }
  });
});

describe("service inputs", () => {
  it("getEntityGraph defaults depth to 1", () => {
    expect(getEntityGraphInputSchema.parse({ type: "CLIENT", id: "cli_1" }).depth).toBe(1);
    expect(
      getEntityGraphInputSchema.safeParse({
        type: "CLIENT",
        id: "cli_1",
        depth: 2,
        include: ["PROJECT"],
        includeArchived: true,
      }).success,
    ).toBe(true);
    expect(
      getEntityGraphInputSchema.safeParse({ type: "CLIENT", id: "cli_1", depth: 0 }).success,
    ).toBe(false);
    expect(getEntityGraphInputSchema.safeParse({ type: "USER", id: "u1" }).success).toBe(false);
    expect(
      getEntityGraphInputSchema.safeParse({ type: "CLIENT", id: "cli_1", include: [] }).success,
    ).toBe(false);
  });

  it("expandNode takes a node id, optional include and cursor", () => {
    expect(
      expandNodeInputSchema.safeParse({ nodeId: "PROJECT:pry_1", cursor: "abc" }).success,
    ).toBe(true);
    expect(expandNodeInputSchema.safeParse({ nodeId: "pry_1" }).success).toBe(false);
    expect(expandNodeInputSchema.safeParse({ nodeId: "PROJECT:pry_1", cursor: "" }).success).toBe(
      false,
    );
  });

  it("getGlobalGraph defaults to clients, projects and documents with no filters", () => {
    const parsed = getGlobalGraphInputSchema.parse({});
    expect(parsed.include).toEqual([...GLOBAL_GRAPH_DEFAULT_TYPES]);
    expect(parsed.filters).toEqual({ onlyActive: false, includeArchived: false });
    expect(
      getGlobalGraphInputSchema.safeParse({
        include: ["CLIENT", "TECHNOLOGY"],
        filters: {
          tagIds: ["t1"],
          technologyIds: ["tech_1"],
          onlyActive: true,
          dateFrom: "2026-01-01",
        },
      }).success,
    ).toBe(true);
    expect(
      getGlobalGraphInputSchema.safeParse({ filters: { dateFrom: "2026-02-30" } }).success,
    ).toBe(false);
  });
});

describe("GraphService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "getEntityGraph",
      "expandNode",
      "getGlobalGraph",
    ] as const satisfies readonly (keyof GraphService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
