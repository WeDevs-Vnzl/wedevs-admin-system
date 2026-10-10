import type { SearchService } from "./search";
import { describe, expect, it } from "vitest";
import {
  SEARCHABLE_ENTITY_TYPE_VALUES,
  SEARCH_PREFIXES,
  parseSearchQuery,
  reindexEntityInputSchema,
  searchGlobalInputSchema,
  searchResultSchema,
  searchResultsSchema,
} from "./search";

describe("search prefixes (PRD §7.6)", () => {
  it("maps c: p: f: d: n:", () => {
    expect(SEARCH_PREFIXES).toEqual({
      c: "CLIENT",
      p: "PROJECT",
      f: "INVOICE",
      d: "DOCUMENT",
      n: "NOTE",
    });
  });

  it("parseSearchQuery splits the prefix from the text", () => {
    expect(parseSearchQuery("c: acme")).toEqual({ text: "acme", entityType: "CLIENT" });
    expect(parseSearchQuery("F:FAC-0042")).toEqual({ text: "FAC-0042", entityType: "INVOICE" });
    expect(parseSearchQuery("  n:   reunión  ")).toEqual({ text: "reunión", entityType: "NOTE" });
    expect(parseSearchQuery("acme corp")).toEqual({ text: "acme corp" });
    expect(parseSearchQuery("x: acme")).toEqual({ text: "x: acme" });
    expect(parseSearchQuery("c:")).toEqual({ text: "", entityType: "CLIENT" });
  });
});

describe("searchGlobal", () => {
  it("accepts a query and applies defaults", () => {
    const parsed = searchGlobalInputSchema.parse({ q: "  kairos " });
    expect(parsed.q).toBe("kairos");
    expect(parsed.includeArchived).toBe(false);
    expect(parsed.limit).toBe(20);
  });

  it("rejects empty or oversized queries and bad limits/types", () => {
    expect(searchGlobalInputSchema.safeParse({ q: "   " }).success).toBe(false);
    expect(searchGlobalInputSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(searchGlobalInputSchema.safeParse({ q: "a", limit: 0 }).success).toBe(false);
    expect(searchGlobalInputSchema.safeParse({ q: "a", limit: 51 }).success).toBe(false);
    expect(searchGlobalInputSchema.safeParse({ q: "a", entityTypes: ["TAG"] }).success).toBe(false);
    expect(searchGlobalInputSchema.safeParse({ q: "a", entityTypes: [] }).success).toBe(false);
    expect(
      searchGlobalInputSchema.safeParse({ q: "a", entityTypes: ["CLIENT", "NOTE"] }).success,
    ).toBe(true);
  });

  it("reindexEntity targets an indexable entity", () => {
    expect(
      reindexEntityInputSchema.safeParse({ entityType: "DOCUMENT", entityId: "doc_1" }).success,
    ).toBe(true);
    expect(reindexEntityInputSchema.safeParse({ entityType: "TAG", entityId: "t1" }).success).toBe(
      false,
    );
    expect(SEARCHABLE_ENTITY_TYPE_VALUES).toHaveLength(9);
  });
});

describe("search DTOs", () => {
  const hit = {
    entityType: "CLIENT",
    entityId: "cli_1",
    code: "CLI-0001",
    title: "Kairos Studio",
    subtitle: "Caracas, VE",
    status: "ACTIVO",
    archived: false,
  };

  it("hit and grouped results", () => {
    expect(searchResultSchema.safeParse(hit).success).toBe(true);
    expect(searchResultSchema.safeParse({ ...hit, archived: undefined }).success).toBe(false);
    expect(
      searchResultsSchema.safeParse({
        query: "kairos",
        entityType: null,
        groups: [{ entityType: "CLIENT", total: 1, items: [hit] }],
      }).success,
    ).toBe(true);
  });
});

describe("SearchService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "searchGlobal",
      "reindexEntity",
    ] as const satisfies readonly (keyof SearchService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
