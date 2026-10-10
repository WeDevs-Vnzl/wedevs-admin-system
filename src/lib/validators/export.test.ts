import { describe, expect, it } from "vitest";
import {
  EXPORT_ENTITY_VALUES,
  MAX_EXPORT_COLUMNS,
  exportCsvInputSchema,
  exportEntitySchema,
} from "./export";

const valid = { entity: "CLIENT", query: {}, columns: ["code", "name", "client.label"] };

describe("exportCsvInputSchema", () => {
  it("accepts entity, a list query and the visible columns in order", () => {
    const parsed = exportCsvInputSchema.parse({
      ...valid,
      query: {
        q: " acme ",
        sort: "name:asc",
        filters: { status: ["ACTIVO"] },
        includeArchived: "true",
      },
    });
    expect(parsed.columns).toEqual(["code", "name", "client.label"]);
    expect(parsed.query).toMatchObject({
      q: "acme",
      sort: "name:asc",
      page: 1,
      includeArchived: true,
    });
  });

  it("defaults the list query like the table does", () => {
    expect(exportCsvInputSchema.parse(valid).query).toMatchObject({
      page: 1,
      pageSize: 25,
      filters: {},
      includeArchived: false,
    });
  });

  it("requires at least one column and no repeats", () => {
    expect(exportCsvInputSchema.safeParse({ ...valid, columns: [] }).success).toBe(false);
    expect(exportCsvInputSchema.safeParse({ ...valid, columns: ["a", "b", "a"] }).success).toBe(
      false,
    );
    const repeated = exportCsvInputSchema.safeParse({ ...valid, columns: ["a", "a"] });
    expect(repeated.error?.issues[0]?.message).toBe("validation.invalidOption");
  });

  it("bounds the number of columns", () => {
    const many = Array.from({ length: MAX_EXPORT_COLUMNS + 1 }, (_, index) => `c${index}`);
    expect(exportCsvInputSchema.safeParse({ ...valid, columns: many }).success).toBe(false);
    expect(exportCsvInputSchema.safeParse({ ...valid, columns: many.slice(1) }).success).toBe(true);
  });

  it("accepts only column ids that look like property paths", () => {
    for (const column of ["", "1abc", "a b", "a-b", "=cmd", "a".repeat(65), 7]) {
      expect(
        exportCsvInputSchema.safeParse({ ...valid, columns: [column] }).success,
        String(column),
      ).toBe(false);
    }
  });

  it("rejects an unknown entity and a malformed query", () => {
    expect(exportCsvInputSchema.safeParse({ ...valid, entity: "WIDGET" }).success).toBe(false);
    expect(exportCsvInputSchema.safeParse({ ...valid, entity: undefined }).success).toBe(false);
    expect(exportCsvInputSchema.safeParse({ ...valid, query: { pageSize: 7 } }).success).toBe(
      false,
    );
    expect(exportCsvInputSchema.safeParse({ ...valid, query: undefined }).success).toBe(false);
  });

  it("lists exportable entities without repeats", () => {
    expect(new Set(EXPORT_ENTITY_VALUES).size).toBe(EXPORT_ENTITY_VALUES.length);
    expect(exportEntitySchema.safeParse("INVOICE").success).toBe(true);
  });
});
