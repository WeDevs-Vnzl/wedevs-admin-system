// MOCK — tests for the global search (PRD §7.6, HU-26, HU-28 CA1 for search; data-rules §7).
import { describe, expect, it } from "vitest";
import {
  searchGlobalInputSchema,
  searchResultsSchema,
  type SearchService,
} from "@/lib/validators/search";
import type { MockServiceContext } from "../ctx";
import type { MockStore } from "../store";
import { makeTestContext } from "../test-helpers";
import * as searchService from "./search";
import { reindexEntity, searchGlobal } from "./search";

const query = (q: string, over: Record<string, unknown> = {}) =>
  searchGlobalInputSchema.parse({ q, ...over });

/** A live client cloned from the first fixture, with its own id, code and names. */
function addClient(db: MockStore, id: string, tradeName: string) {
  const base = db.clients.find((row) => !row.archivedAt)!;
  db.clients.push({
    ...structuredClone(base),
    id,
    code: `CLI-9${db.clients.length}`,
    tradeName,
    legalName: tradeName,
  });
}

const hits = (result: Awaited<ReturnType<typeof searchGlobal>>) =>
  result.groups.flatMap((group) => group.items.map((item) => item.entityId));

describe("HU-26: global search", () => {
  it('CA1: "garcia" finds "García" (ignores accents)', async () => {
    const { ctx, db } = makeTestContext("OWNER");
    addClient(db, "cli_garcia", "Talleres García");
    const result = await searchGlobal(ctx, query("garcia"));
    expect(hits(result)).toContain("cli_garcia");
    expect(searchResultsSchema.safeParse(result).success).toBe(true);
  });

  it('CA2: "invsion" finds "Inversión" (trigram similarity)', async () => {
    const { ctx, db } = makeTestContext("OWNER");
    addClient(db, "cli_inversion", "Inversión Delta");
    expect(hits(await searchGlobal(ctx, query("invsion")))).toContain("cli_inversion");
  });

  it("CA3: the exact code FAC-0003 resolves to that invoice alone", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const invoice = db.invoices.find((row) => row.code === "FAC-0003")!;
    const result = await searchGlobal(ctx, query("fac-0003"));
    expect(result.groups).toEqual([
      {
        entityType: "INVOICE",
        total: 1,
        items: [
          {
            entityType: "INVOICE",
            entityId: invoice.id,
            code: "FAC-0003",
            title: invoice.invoiceNumber,
            subtitle: invoice.client.label,
            status: invoice.status,
            archived: false,
          },
        ],
      },
    ]);
  });

  it("CA3: the exact fiscal invoice number resolves to that invoice alone", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const invoice = db.invoices.find((row) => row.invoiceNumber === "KAI-0001")!;
    const result = await searchGlobal(ctx, query("kai-0001"));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ entityType: "INVOICE", total: 1 });
    expect(result.groups[0]!.items.map((item) => item.entityId)).toEqual([invoice.id]);
  });
});

describe("result shape (PRD §7.6)", () => {
  it("groups by entity type in a stable order with icon type, code, title, subtitle and status", async () => {
    const { ctx } = makeTestContext("OWNER");
    const result = await searchGlobal(ctx, query("kairos"));
    const order = result.groups.map((group) => group.entityType);
    expect(order).toEqual(
      [
        "CLIENT",
        "CONTACT",
        "PROJECT",
        "INVOICE",
        "PAYMENT",
        "EXPENSE",
        "ACCOUNT",
        "DOCUMENT",
        "NOTE",
      ].filter((type) => order.includes(type as never)),
    );
    const client = result.groups.find((group) => group.entityType === "CLIENT")!.items[0]!;
    expect(client).toMatchObject({ title: "Kairos Studio", code: expect.stringMatching(/^CLI-/) });
    expect(client.status).toEqual(expect.any(String));
  });

  it("caps the results at `limit` while each group keeps its total", async () => {
    const { ctx } = makeTestContext("OWNER");
    const result = await searchGlobal(ctx, query("a", { limit: 3 }));
    const shown = result.groups.reduce((sum, group) => sum + group.items.length, 0);
    const total = result.groups.reduce((sum, group) => sum + group.total, 0);
    expect(shown).toBe(3);
    expect(total).toBeGreaterThan(3);
  });
});

describe("prefixes c: p: f: d: n:", () => {
  it.each([
    ["c: kairos", "CLIENT"],
    ["p: kairos", "PROJECT"],
    ["f: kairos", "INVOICE"],
    ["d: kairos", "DOCUMENT"],
    ["n: a", "NOTE"],
  ] as const)("%s searches only %s", async (q, type) => {
    const { ctx } = makeTestContext("OWNER");
    const result = await searchGlobal(ctx, query(q));
    expect(result.entityType).toBe(type);
    expect(result.groups.map((group) => group.entityType)).toEqual([type]);
    expect(result.query).toBe(q.slice(3));
  });

  it("without a prefix `entityTypes` narrows the search", async () => {
    const { ctx } = makeTestContext("OWNER");
    const result = await searchGlobal(ctx, query("kairos", { entityTypes: ["PROJECT"] }));
    expect(result.entityType).toBeNull();
    expect(result.groups.map((group) => group.entityType)).toEqual(["PROJECT"]);
  });
});

describe("HU-28 CA1 and visibility", () => {
  it("leaves archived records out unless includeArchived for Owner/Admin", async () => {
    const { ctx } = makeTestContext("OWNER");
    expect(hits(await searchGlobal(ctx, query("veredas")))).toEqual([]);
    const withArchived = await searchGlobal(ctx, query("veredas", { includeArchived: true }));
    expect(hits(withArchived)).toContain("cli_veredas_digital");
    expect(withArchived.groups[0]!.items[0]!.archived).toBe(true);
  });

  it("a Member gets no archived rows and no financial entities", async () => {
    const { ctx } = makeTestContext("MEMBER");
    expect(hits(await searchGlobal(ctx, query("veredas", { includeArchived: true })))).toEqual([]);
    const types = (await searchGlobal(ctx, query("kairos"))).groups.map((g) => g.entityType);
    expect(types).toContain("CLIENT");
    expect(types).not.toContain("INVOICE");
    const byCode = await searchGlobal(ctx, query("FAC-0003"));
    expect(byCode.groups.map((g) => g.entityType)).not.toContain("INVOICE");
  });
});

describe("reindexEntity", () => {
  it("reports whether the entity exists and is indexable", async () => {
    const { ctx } = makeTestContext("OWNER");
    expect(await reindexEntity(ctx, { entityType: "CLIENT", entityId: "cli_kairos" })).toEqual({
      entityType: "CLIENT",
      entityId: "cli_kairos",
      indexed: true,
    });
    expect(
      (await reindexEntity(ctx, { entityType: "NOTE", entityId: "note_missing" })).indexed,
    ).toBe(false);
  });

  it("satisfies SearchService over the mock context", () => {
    const service = searchService satisfies SearchService<MockServiceContext>;
    expect(typeof service.searchGlobal).toBe("function");
  });
});
