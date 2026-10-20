// MOCK — tests for the in-memory list helper.
import { describe, expect, it } from "vitest";
import { foldText, listRows, type ListSpec } from "./list";

interface Row {
  name: string;
  qty: number | null;
  on: boolean;
}

const rows: Row[] = [
  { name: "Cotización", qty: 3, on: true },
  { name: "Acta", qty: null, on: false },
  { name: "Banco", qty: 1, on: true },
  { name: "acuerdo", qty: 2, on: false },
];

const spec: ListSpec<Row> = {
  searchText: (row) => [row.name],
  sorters: { name: (row) => row.name, qty: (row) => row.qty, on: (row) => row.on },
  defaultSort: "name:asc",
};

const query = { page: 1, pageSize: 25 as const };

describe("foldText", () => {
  it("lower-cases and strips accents", () => {
    expect(foldText("Cotización")).toBe("cotizacion");
  });
});

describe("listRows", () => {
  it("sorts by the default sort, accent- and case-insensitively", () => {
    expect(listRows(rows, query, spec).items.map((r) => r.name)).toEqual([
      "Acta",
      "acuerdo",
      "Banco",
      "Cotización",
    ]);
  });

  it("honours the requested sort and direction, with null values last", () => {
    expect(listRows(rows, { ...query, sort: "qty:desc" }, spec).items.map((r) => r.qty)).toEqual([
      3,
      2,
      1,
      null,
    ]);
    expect(listRows(rows, { ...query, sort: "on:asc" }, spec).items[0]?.on).toBe(false);
  });

  it("falls back to the default sort for a field it does not know", () => {
    expect(listRows(rows, { ...query, sort: "nope:asc" }, spec).items[0]?.name).toBe("Acta");
  });

  it("filters by the free-text query without accents", () => {
    const result = listRows(rows, { ...query, q: "cotizacion" }, spec);
    expect(result.items.map((r) => r.name)).toEqual(["Cotización"]);
    expect(result.total).toBe(1);
  });

  it("paginates and reports the totals", () => {
    const result = listRows(rows, { page: 2, pageSize: 25 }, spec);
    expect(result.items).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => ({
      name: `n${String(i).padStart(2, "0")}`,
      qty: i,
      on: true,
    }));
    const page3 = listRows(many, { page: 3, pageSize: 25 }, spec);
    expect(page3.items).toHaveLength(10);
    expect(page3).toMatchObject({ total: 60, page: 3, pageSize: 25, pageCount: 3 });
  });

  it("does not mutate the input rows", () => {
    const copy = structuredClone(rows);
    listRows(rows, { ...query, sort: "qty:desc" }, spec);
    expect(rows).toEqual(copy);
  });
});
