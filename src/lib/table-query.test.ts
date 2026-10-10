import { describe, expect, it } from "vitest";
import { toModuleQuery, type TableFacetDescriptor } from "./table-query";
import { listQuerySchema } from "@/lib/validators/common";
import { invoiceFiltersSchema } from "@/lib/validators/invoices";
import { shareFilterSchema } from "@/lib/validators/shares";

const query = (patch: Record<string, unknown>) => listQuerySchema.parse(patch);

describe("toModuleQuery", () => {
  it("flattens facets and maps a date range to the invoice keys (dateFrom/dateTo)", () => {
    const facets: TableFacetDescriptor[] = [
      { id: "status", kind: "options" },
      { id: "clientId", kind: "async" },
      { id: "date", kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo" },
    ];
    const flat = toModuleQuery(
      query({
        page: 2,
        sort: "number:desc",
        q: "acme",
        filters: { status: ["EMITIDA", "PAGADA"], clientId: ["CLI-0001"], date: ["2026-03-01", "2026-03-31"] },
      }),
      facets,
    );

    expect(flat).toMatchObject({
      page: 2,
      sort: "number:desc",
      q: "acme",
      status: ["EMITIDA", "PAGADA"],
      clientId: "CLI-0001",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
    });
    expect(flat).not.toHaveProperty("filters");
    const parsed = invoiceFiltersSchema.safeParse(flat);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dateFrom).toBe("2026-03-01");
      expect(parsed.data.dateTo).toBe("2026-03-31");
      expect(parsed.data.status).toEqual(["EMITIDA", "PAGADA"]);
    }
  });

  it("defaults a date range to <id>From / <id>To (shareFilterSchema createdFrom/createdTo)", () => {
    const flat = toModuleQuery(
      query({ filters: { created: ["2026-01-01", "2026-01-31"], status: ["ACTIVE"] } }),
      [
        { id: "created", kind: "dateRange", fromKey: "createdFrom", toKey: "createdTo" },
        { id: "status", kind: "options" },
      ],
    );
    const parsed = shareFilterSchema.safeParse(flat);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.createdFrom).toBe("2026-01-01");
      expect(parsed.data.createdTo).toBe("2026-01-31");
    }

    expect(toModuleQuery(query({ filters: { createdAt: ["2026-01-01", "2026-01-31"] } }), [
      { id: "createdAt", kind: "dateRange" },
    ])).toMatchObject({ createdAtFrom: "2026-01-01", createdAtTo: "2026-01-31" });
  });

  it("drops empty facets and keeps the base query fields", () => {
    const flat = toModuleQuery(query({ filters: { status: [] , empty: "" } }), [
      { id: "status", kind: "options" },
    ]);
    expect(flat).toEqual({ page: 1, pageSize: 25, includeArchived: false });
  });

  it("passes unknown filters through but never overrides the base fields", () => {
    const flat = toModuleQuery(query({ q: "x", filters: { tagId: "TAG-1", q: "evil", page: "9" } }));
    expect(flat).toMatchObject({ tagId: "TAG-1", q: "x", page: 1 });
  });

  it("handles a half-open date range", () => {
    const flat = toModuleQuery(query({ filters: { date: ["2026-03-01"] } }), [
      { id: "date", kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo" },
    ]);
    expect(flat).toMatchObject({ dateFrom: "2026-03-01" });
    expect(flat).not.toHaveProperty("dateTo");
  });
});
