// MOCK — tests for the graph services (PRD §8.12, HU-24, HU-25, HU-28 CA1).
import { describe, expect, it } from "vitest";
import {
  GLOBAL_GRAPH_DEFAULT_TYPES,
  GRAPH_EXPANSION_LIMIT,
  GRAPH_NODE_TYPE_VALUES,
  getGlobalGraphInputSchema,
  graphNodeId,
  graphResponseSchema,
  type GetGlobalGraphInput,
  type GraphResponse,
  type GraphService,
} from "@/lib/validators/graph";
import type { MockServiceContext } from "../ctx";
import { appendGraphStressRecords, GRAPH_STRESS_DEFAULT_NODES } from "../fixtures/graph-stress";
import type { MockStore } from "../store";
import { makeTestContext } from "../test-helpers";
import { expandNode, getEntityGraph, getGlobalGraph } from "./graph";

// Type test: the module satisfies the PRD §8.12.5 graph contract (C8, C9).
const contract = {
  getEntityGraph,
  expandNode,
  getGlobalGraph,
} satisfies GraphService<MockServiceContext>;

const KAIROS = "cli_kairos";
const KAIROS_APP = "pry_kairos_app";
const MOCHIMA = "cli_hotel_mochima";

const ids = (response: GraphResponse) => response.nodes.map((node) => node.id).sort();
const typesOf = (response: GraphResponse) => new Set(response.nodes.map((node) => node.type));

function globalInput(raw: Record<string, unknown> = {}): GetGlobalGraphInput {
  return getGlobalGraphInputSchema.parse(raw);
}

/** Adds `count` live contacts to `clientId`, cloned from an existing contact. */
function addContacts(db: MockStore, clientId: string, count: number): void {
  const template = db.contacts[0];
  if (!template) throw new Error("no contact fixture");
  for (let i = 0; i < count; i += 1) {
    db.contacts.push({
      ...structuredClone(template),
      id: `con_bulk_${String(i).padStart(3, "0")}`,
      clientId,
      fullName: `Contacto ${String(i).padStart(3, "0")}`,
      archivedAt: null,
    });
  }
}

describe("graph contract", () => {
  it("exposes the three services", () => {
    expect(Object.keys(contract).sort()).toEqual([
      "expandNode",
      "getEntityGraph",
      "getGlobalGraph",
    ]);
  });
});

describe("getEntityGraph", () => {
  it("HU-24 CA1: the client root with its direct contacts, projects, invoices, payments, documents and notes", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const graph = await getEntityGraph(ctx, { type: "CLIENT", id: KAIROS, depth: 1 });
    expect(graphResponseSchema.safeParse(graph).success).toBe(true);

    const root = graphNodeId("CLIENT", KAIROS);
    const expected = [
      root,
      ...db.contacts
        .filter((row) => row.clientId === KAIROS && !row.archivedAt)
        .map((row) => graphNodeId("CONTACT", row.id)),
      ...db.projects
        .filter((row) => !row.archivedAt && row.clients.some((c) => c.clientId === KAIROS))
        .map((row) => graphNodeId("PROJECT", row.id)),
      ...db.invoices
        .filter((row) => !row.archivedAt && row.client.id === KAIROS)
        .map((row) => graphNodeId("INVOICE", row.id)),
      ...db.payments
        .filter((row) => row.client.id === KAIROS)
        .map((row) => graphNodeId("PAYMENT", row.id)),
      ...db.documentLinks
        .filter((link) => link.entityType === "CLIENT" && link.entityId === KAIROS)
        .map((link) => graphNodeId("DOCUMENT", link.documentId)),
      ...db.notes
        .filter(
          (row) =>
            !row.archivedAt &&
            row.links.some((l) => l.entityType === "CLIENT" && l.entityId === KAIROS),
        )
        .map((row) => graphNodeId("NOTE", row.id)),
    ];
    expect(ids(graph)).toEqual([...new Set(expected)].sort());
    for (const type of ["CONTACT", "PROJECT", "INVOICE", "PAYMENT", "DOCUMENT", "NOTE"] as const) {
      expect(typesOf(graph).has(type)).toBe(true);
    }
    // Depth 1: every edge touches the root; technologies and tags stay hidden by default.
    expect(graph.edges.every((edge) => edge.source === root || edge.target === root)).toBe(true);
    expect(typesOf(graph).has("TAG")).toBe(false);
    expect(typesOf(graph).has("TECHNOLOGY")).toBe(false);
    expect(graph.truncated).toEqual([]);
  });

  it("labels the client ↔ project edge `participa` with the role", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const graph = await getEntityGraph(ctx, { type: "CLIENT", id: KAIROS, depth: 1 });
    const project = db.projects.find((row) => row.id === "pry_kairos_web");
    const edge = graph.edges.find(
      (item) => item.target === graphNodeId("PROJECT", "pry_kairos_web"),
    );
    expect(edge).toMatchObject({
      source: graphNodeId("CLIENT", KAIROS),
      relation: "participa",
      label: project?.clients[0]?.role,
    });
  });

  it("include narrows the neighbour types", async () => {
    const { ctx } = makeTestContext("OWNER");
    const graph = await getEntityGraph(ctx, {
      type: "CLIENT",
      id: KAIROS,
      depth: 1,
      include: ["PROJECT"],
    });
    expect([...typesOf(graph)].sort()).toEqual(["CLIENT", "PROJECT"]);
  });

  it("degree counts every relation of the node, not only the loaded ones", async () => {
    const { ctx } = makeTestContext("OWNER");
    const full = await getEntityGraph(ctx, {
      type: "CLIENT",
      id: KAIROS,
      depth: 1,
      include: [...GRAPH_NODE_TYPE_VALUES],
    });
    const narrow = await getEntityGraph(ctx, {
      type: "CLIENT",
      id: KAIROS,
      depth: 1,
      include: ["PROJECT"],
    });
    const root = graphNodeId("CLIENT", KAIROS);
    const degree = narrow.nodes.find((node) => node.id === root)?.degree;
    expect(degree).toBe(full.nodes.length - 1);
  });

  it("unknown id → NOT_FOUND", async () => {
    const { ctx } = makeTestContext("OWNER");
    await expect(
      getEntityGraph(ctx, { type: "CLIENT", id: "cli_missing", depth: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("financial nodes are hidden from roles without financial visibility", async () => {
    const { ctx } = makeTestContext("MEMBER");
    const graph = await getEntityGraph(ctx, { type: "CLIENT", id: KAIROS, depth: 1 });
    expect(typesOf(graph).has("INVOICE")).toBe(false);
    expect(typesOf(graph).has("PAYMENT")).toBe(false);
    const root = graph.nodes.find((node) => node.id === graphNodeId("CLIENT", KAIROS));
    expect(root?.meta.receivableUsd ?? null).toBeNull();
    await expect(
      getEntityGraph(ctx, { type: "INVOICE", id: "inv_kairos_paid", depth: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("depth 2 reaches the neighbours of the neighbours", async () => {
    const { ctx } = makeTestContext("OWNER");
    const graph = await getEntityGraph(ctx, { type: "CLIENT", id: KAIROS, depth: 2 });
    expect(ids(graph)).toContain(graphNodeId("CLIENT", MOCHIMA));
  });
});

describe("expandNode", () => {
  it("HU-24 CA2: a project yields its documents, invoices, expenses and the other clients", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const invoice = db.invoices[0];
    const expense = db.expenses[0];
    const line = invoice?.lines[0];
    if (!invoice || !expense || !line) throw new Error("finance fixtures missing");
    line.project = { type: "PROJECT", id: KAIROS_APP, label: "App", code: "PRY" };
    expense.project = { type: "PROJECT", id: KAIROS_APP, label: "App", code: "PRY" };
    const document = db.documents[0];
    if (!document) throw new Error("document fixtures missing");
    db.documentLinks.push({
      id: "dln_graph_test",
      documentId: document.id,
      entityType: "PROJECT",
      entityId: KAIROS_APP,
      createdAt: "2026-10-01T12:00:00.000Z",
    });

    const graph = await expandNode(ctx, { nodeId: graphNodeId("PROJECT", KAIROS_APP) });
    const got = ids(graph);
    expect(got).toContain(graphNodeId("DOCUMENT", document.id));
    expect(got).toContain(graphNodeId("INVOICE", invoice.id));
    expect(got).toContain(graphNodeId("EXPENSE", expense.id));
    expect(got).toContain(graphNodeId("CLIENT", KAIROS));
    expect(got).toContain(graphNodeId("CLIENT", MOCHIMA));
    expect(graph.edges.find((e) => e.source === graphNodeId("EXPENSE", expense.id))).toMatchObject({
      target: graphNodeId("PROJECT", KAIROS_APP),
      relation: "imputado_a",
    });
  });

  it("HU-24 CA5: at most 50 neighbours, the rest as truncated, the cursor loads the next page", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    addContacts(db, KAIROS, 60);
    const root = graphNodeId("CLIENT", KAIROS);

    const first = await getEntityGraph(ctx, { type: "CLIENT", id: KAIROS, depth: 1 });
    expect(first.nodes).toHaveLength(1 + GRAPH_EXPANSION_LIMIT);
    expect(first.truncated).toHaveLength(1);
    const remaining = first.truncated[0]?.remaining ?? 0;
    expect(first.truncated[0]?.nodeId).toBe(root);
    expect(remaining).toBeGreaterThan(0);

    const second = await expandNode(ctx, {
      nodeId: root,
      cursor: String(GRAPH_EXPANSION_LIMIT),
    });
    expect(second.truncated).toEqual([]);
    const neighbours = (r: GraphResponse) => r.nodes.filter((n) => n.id !== root).map((n) => n.id);
    expect(neighbours(second)).toHaveLength(remaining);
    const all = new Set([...neighbours(first), ...neighbours(second)]);
    expect(all.size).toBe(GRAPH_EXPANSION_LIMIT + remaining);
    for (const contact of db.contacts.filter((row) => row.id.startsWith("con_bulk_"))) {
      expect(all.has(graphNodeId("CONTACT", contact.id))).toBe(true);
    }
  });

  it("truncated carries the cursor of the next page", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    addContacts(db, KAIROS, 60);
    const first = await getEntityGraph(ctx, { type: "CLIENT", id: KAIROS, depth: 1 });
    expect(first.truncated[0]?.cursor).toBe(String(GRAPH_EXPANSION_LIMIT));
  });

  it("expandNode pages the same way without a cursor", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    addContacts(db, KAIROS, 60);
    const graph = await expandNode(ctx, { nodeId: graphNodeId("CLIENT", KAIROS) });
    expect(graph.nodes.filter((n) => n.id !== graphNodeId("CLIENT", KAIROS))).toHaveLength(
      GRAPH_EXPANSION_LIMIT,
    );
    expect(graph.truncated).toHaveLength(1);
  });

  it("an invalid cursor → VALIDATION", async () => {
    const { ctx } = makeTestContext("OWNER");
    await expect(
      expandNode(ctx, { nodeId: graphNodeId("CLIENT", KAIROS), cursor: "abc" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("unknown node → NOT_FOUND", async () => {
    const { ctx } = makeTestContext("OWNER");
    await expect(
      expandNode(ctx, { nodeId: graphNodeId("PROJECT", "pry_missing") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("archived nodes (HU-28 CA1)", () => {
  function archiveFirstContact(db: MockStore): string {
    const contact = db.contacts.find((row) => row.clientId === KAIROS && !row.archivedAt);
    if (!contact) throw new Error("no Kairos contact");
    contact.archivedAt = "2026-10-01T12:00:00.000Z";
    return graphNodeId("CONTACT", contact.id);
  }

  it("are excluded unless includeArchived is set", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const archived = archiveFirstContact(db);
    const hidden = await getEntityGraph(ctx, { type: "CLIENT", id: KAIROS, depth: 1 });
    expect(ids(hidden)).not.toContain(archived);

    const shown = await getEntityGraph(ctx, {
      type: "CLIENT",
      id: KAIROS,
      depth: 1,
      includeArchived: true,
    });
    expect(shown.nodes.find((node) => node.id === archived)?.archived).toBe(true);
  });

  it("expandNode keeps the archived toggle", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const archived = archiveFirstContact(db);
    const nodeId = graphNodeId("CLIENT", KAIROS);
    expect(ids(await expandNode(ctx, { nodeId }))).not.toContain(archived);
    expect(ids(await expandNode(ctx, { nodeId, includeArchived: true }))).toContain(archived);

    const member = makeTestContext("MEMBER");
    const hidden = archiveFirstContact(member.db);
    expect(ids(await expandNode(member.ctx, { nodeId, includeArchived: true }))).not.toContain(
      hidden,
    );
  });

  it("need Owner/Admin even with the toggle", async () => {
    const { ctx, db } = makeTestContext("MEMBER");
    const archived = archiveFirstContact(db);
    const graph = await getEntityGraph(ctx, {
      type: "CLIENT",
      id: KAIROS,
      depth: 1,
      includeArchived: true,
    });
    expect(ids(graph)).not.toContain(archived);
  });

  it("an archived root is NOT_FOUND for roles without the trash grant", async () => {
    const member = makeTestContext("MEMBER");
    const client = member.db.clients.find((row) => row.id === KAIROS);
    if (client) client.archivedAt = "2026-10-01T12:00:00.000Z";
    await expect(
      getEntityGraph(member.ctx, { type: "CLIENT", id: KAIROS, depth: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const owner = makeTestContext("OWNER");
    const ownerClient = owner.db.clients.find((row) => row.id === KAIROS);
    if (ownerClient) ownerClient.archivedAt = "2026-10-01T12:00:00.000Z";
    const graph = await getEntityGraph(owner.ctx, {
      type: "CLIENT",
      id: KAIROS,
      depth: 1,
      includeArchived: true,
    });
    expect(graph.nodes.find((node) => node.id === graphNodeId("CLIENT", KAIROS))?.archived).toBe(
      true,
    );
  });
});

describe("getGlobalGraph", () => {
  it("HU-25 CA1: clients, projects and documents by default, archived excluded", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const graph = await getGlobalGraph(ctx, globalInput());
    expect(graphResponseSchema.safeParse(graph).success).toBe(true);
    expect([...typesOf(graph)].sort()).toEqual([...GLOBAL_GRAPH_DEFAULT_TYPES].sort());
    const expected =
      db.clients.filter((row) => !row.archivedAt).length +
      db.projects.filter((row) => !row.archivedAt).length +
      db.documents.filter((row) => !row.archivedAt).length;
    expect(graph.nodes).toHaveLength(expected);
    expect(graph.nodes.some((node) => node.archived)).toBe(false);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.edges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target))).toBe(true);
    expect(graph.truncated).toEqual([]);
  });

  it("includeArchived shows the archived nodes to Owner/Admin", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const archived = db.clients.find((row) => row.archivedAt);
    if (!archived) throw new Error("no archived client fixture");
    const graph = await getGlobalGraph(ctx, globalInput({ filters: { includeArchived: true } }));
    expect(ids(graph)).toContain(graphNodeId("CLIENT", archived.id));
  });

  it("onlyActive hides inactive clients and finished projects", async () => {
    const { ctx } = makeTestContext("OWNER");
    const graph = await getGlobalGraph(ctx, globalInput({ filters: { onlyActive: true } }));
    const clients = graph.nodes.filter((node) => node.type === "CLIENT");
    const projects = graph.nodes.filter((node) => node.type === "PROJECT");
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.some((node) => node.status === "INACTIVO")).toBe(false);
    expect(projects.some((node) => ["ENTREGADO", "CANCELADO"].includes(node.status ?? ""))).toBe(
      false,
    );
  });

  it("statuses keep only the nodes with those statuses", async () => {
    const { ctx } = makeTestContext("OWNER");
    const graph = await getGlobalGraph(
      ctx,
      globalInput({ include: ["PROJECT"], filters: { statuses: ["EN_CURSO"] } }),
    );
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.every((node) => node.status === "EN_CURSO")).toBe(true);
  });

  it("technologyIds keep the projects that use one of them", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const graph = await getGlobalGraph(
      ctx,
      globalInput({ include: ["PROJECT"], filters: { technologyIds: ["tec_next_js"] } }),
    );
    const expected = db.projects
      .filter((row) => !row.archivedAt && row.technologyIds.includes("tec_next_js"))
      .map((row) => graphNodeId("PROJECT", row.id))
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(graph)).toEqual(expected);
  });

  it("tagIds keep the tagged records", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const graph = await getGlobalGraph(
      ctx,
      globalInput({ include: ["PROJECT"], filters: { tagIds: ["tag_prioritario"] } }),
    );
    const expected = db.projects
      .filter((row) => !row.archivedAt && row.tagIds.includes("tag_prioritario"))
      .map((row) => graphNodeId("PROJECT", row.id))
      .sort();
    expect(ids(graph)).toEqual(expected);
  });

  it("clientIds keep those clients, their projects and the documents linked to them", async () => {
    const { ctx } = makeTestContext("OWNER");
    const graph = await getGlobalGraph(ctx, globalInput({ filters: { clientIds: [KAIROS] } }));
    const clients = graph.nodes.filter((node) => node.type === "CLIENT").map((node) => node.id);
    expect(clients).toEqual([graphNodeId("CLIENT", KAIROS)]);
    expect(ids(graph)).toContain(graphNodeId("PROJECT", "pry_kairos_web"));
    expect(ids(graph)).not.toContain(graphNodeId("PROJECT", "pry_tamanaco_erp"));
  });

  it("dateFrom/dateTo filter on the main date of the node", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const graph = await getGlobalGraph(
      ctx,
      globalInput({
        include: ["PROJECT"],
        filters: { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
      }),
    );
    const expected = db.projects
      .filter(
        (row) =>
          !row.archivedAt &&
          (row.startDate ?? row.createdAt.slice(0, 10)) >= "2026-07-01" &&
          (row.startDate ?? row.createdAt.slice(0, 10)) <= "2026-07-31",
      )
      .map((row) => graphNodeId("PROJECT", row.id))
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(graph)).toEqual(expected);
  });

  it("drops the financial types for roles without financial visibility", async () => {
    const { ctx } = makeTestContext("VIEWER");
    const graph = await getGlobalGraph(ctx, globalInput({ include: ["CLIENT", "INVOICE"] }));
    expect([...typesOf(graph)]).toEqual(["CLIENT"]);
  });
});

describe("graph stress fixture (HU-25 CA3 manual check)", () => {
  it("adds a deterministic set of ~500 default-type nodes", async () => {
    const a = makeTestContext("OWNER");
    const b = makeTestContext("OWNER");
    appendGraphStressRecords(a.db);
    appendGraphStressRecords(b.db);
    const graphA = await getGlobalGraph(a.ctx, globalInput());
    const graphB = await getGlobalGraph(b.ctx, globalInput());
    const base = await getGlobalGraph(makeTestContext("OWNER").ctx, globalInput());
    expect(graphA.nodes.length - base.nodes.length).toBe(GRAPH_STRESS_DEFAULT_NODES);
    expect(graphA.nodes.length).toBeGreaterThanOrEqual(500);
    expect(ids(graphA)).toEqual(ids(graphB));
    expect(graphA.edges.length).toBe(graphB.edges.length);
  });
});
