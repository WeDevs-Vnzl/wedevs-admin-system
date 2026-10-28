import { describe, expect, it } from "vitest";
import { documentFilterSchema } from "@/lib/validators/documents";
import type { ListQuery } from "@/lib/validators/common";
import { documentFilterOf, documentsListHref } from "./documents-table-query";

function query(filters: ListQuery["filters"], extra: Partial<ListQuery> = {}): ListQuery {
  return { page: 1, pageSize: 25, q: undefined, includeArchived: false, filters, ...extra };
}

describe("documentFilterOf", () => {
  it("maps the table facets onto the documents filter", () => {
    const filter = documentFilterOf(
      query(
        {
          status: ["BORRADOR", "APROBADO"],
          categoryId: ["cat_1"],
          format: ["MARKDOWN"],
          clientId: ["cli_1"],
          expires: ["2026-01-01", "2026-12-31"],
        },
        { q: "contrato", sort: "expiresAt:asc" },
      ),
    );
    expect(filter).toMatchObject({
      q: "contrato",
      sort: "expiresAt:asc",
      status: ["BORRADOR", "APROBADO"],
      categoryId: "cat_1",
      format: "MARKDOWN",
      clientId: "cli_1",
      expiresFrom: "2026-01-01",
      expiresTo: "2026-12-31",
    });
    expect(documentFilterSchema.safeParse(filter).success).toBe(true);
  });

  it("filters by shared only when exactly one of yes/no is chosen", () => {
    expect(documentFilterSchema.parse(documentFilterOf(query({ shared: ["true"] }))).shared).toBe(
      true,
    );
    const both = documentFilterOf(query({ shared: ["true", "false"] }));
    expect(both).not.toHaveProperty("shared");
    expect(documentFilterSchema.safeParse(both).success).toBe(true);
  });

  it("passes the overview shortcuts through", () => {
    const filter = documentFilterSchema.parse(
      documentFilterOf(query({ expiringWithinDays: "30", staleDraft: "true" })),
    );
    expect(filter.expiringWithinDays).toBe(30);
    expect(filter.staleDraft).toBe(true);
  });
});

describe("documentsListHref", () => {
  it("opens the table with the given filters in its URL state", () => {
    const href = documentsListHref({ expiringWithinDays: "60" });
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/documents/list");
    expect(JSON.parse(url.searchParams.get("filters")!)).toEqual({ expiringWithinDays: "60" });
  });
});
