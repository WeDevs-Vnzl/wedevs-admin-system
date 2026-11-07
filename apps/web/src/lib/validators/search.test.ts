import { describe, expect, it } from "vitest";
import {
  SEARCHABLE_ENTITY_TYPE_VALUES,
  SEARCH_PREFIXES,
  parseSearchQuery,
  reindexEntityInputSchema,
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
