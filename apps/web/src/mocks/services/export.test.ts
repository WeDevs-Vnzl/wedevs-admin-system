import { describe, expect, it, vi } from "vitest";
import { listQuerySchema, paginated } from "@/lib/validators/common";
import { z } from "@/lib/validators/zod";
import { EXPORT_MAX_ROWS, exportCsvInputSchema, type ExportSource } from "@/lib/validators/export";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import { exportCsv } from "./export";

interface Row {
  name: string;
  total: string;
  status: string;
}

const filterSchema = listQuerySchema.omit({ filters: true }).extend({
  status: z.string().optional(),
  createdFrom: z.string().optional(),
});
type Filter = z.output<typeof filterSchema>;

function makeSource(all: Row[]) {
  const list = vi.fn(async (_ctx: unknown, filter: Filter) => {
    const matching = all.filter((r) => !filter.status || r.status === filter.status);
    const start = (filter.page - 1) * filter.pageSize;
    return paginated(matching.slice(start, start + filter.pageSize), matching.length, filter);
  });
  const source: ExportSource<Row, Filter, ReturnType<typeof makeTestContext>["ctx"]> = {
    entity: "CLIENT",
    facets: [
      { id: "status", kind: "options" },
      { id: "created", kind: "dateRange", fromKey: "createdFrom", toKey: "createdTo" },
    ],
    filterSchema: filterSchema as never,
    list: list as never,
    columns: {
      name: { labelKey: "Nombre", value: (r) => r.name },
      total: { labelKey: "Total", type: "money", value: (r) => r.total },
      status: { labelKey: "Estado", value: (r) => r.status },
    },
  };
  return { source, list };
}

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Cliente ${i + 1}`,
    total: "1234.50",
    status: i % 2 === 0 ? "ACTIVO" : "PROSPECTO",
  }));

const input = (overrides: Record<string, unknown> = {}) =>
  exportCsvInputSchema.parse({
    entity: "CLIENT",
    query: {},
    columns: ["name", "total"],
    ...overrides,
  });

describe("exportCsv", () => {
  const { ctx } = makeTestContext();

  it("writes BOM, CRLF, the requested columns in order and money verbatim", async () => {
    const { source } = makeSource(rows(2));
    const result = await exportCsv(ctx, input({ columns: ["total", "name"] }), source as never);
    expect(result.content).toBe("﻿Total,Nombre\r\n1234.50,Cliente 1\r\n1234.50,Cliente 2\r\n");
    expect(result).toMatchObject({ rowCount: 2, truncated: false });
  });

  it("applies the query filters through toModuleQuery and the filter schema", async () => {
    const { source, list } = makeSource(rows(6));
    const result = await exportCsv(
      ctx,
      input({
        query: { filters: { status: ["PROSPECTO"], created: ["2026-01-01", "2026-02-01"] } },
      }),
      source as never,
    );
    expect(result.rowCount).toBe(3);
    expect(list.mock.calls[0]![1]).toMatchObject({
      status: "PROSPECTO",
      createdFrom: "2026-01-01",
      page: 1,
      pageSize: 100,
    });
  });

  it("pages through the list service, 100 rows at a time", async () => {
    const { source, list } = makeSource(rows(250));
    const result = await exportCsv(ctx, input(), source as never);
    expect(list).toHaveBeenCalledTimes(3);
    expect(result.rowCount).toBe(250);
    expect(result.content.split("\r\n")).toHaveLength(250 + 2);
  });

  it("caps at 10,000 rows and flags truncated", async () => {
    const { source } = makeSource(rows(EXPORT_MAX_ROWS + 150));
    const result = await exportCsv(ctx, input(), source as never);
    expect(result.rowCount).toBe(EXPORT_MAX_ROWS);
    expect(result.truncated).toBe(true);
  });

  it("is not truncated at exactly the cap", async () => {
    const { source } = makeSource(rows(EXPORT_MAX_ROWS));
    const result = await exportCsv(ctx, input(), source as never);
    expect(result).toMatchObject({ rowCount: EXPORT_MAX_ROWS, truncated: false });
  });

  it("rejects an unknown column and a mismatching entity with VALIDATION", async () => {
    const { source } = makeSource(rows(1));
    await expect(
      exportCsv(ctx, input({ columns: ["name", "nope"] }), source as never),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      exportCsv(ctx, input({ columns: ["constructor"] }), source as never),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      exportCsv(ctx, input({ entity: "PROJECT" }), source as never),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("guards text cells against formulas but not money", async () => {
    const { source } = makeSource([{ name: "=HYPERLINK(1)", total: "-5.00", status: "ACTIVO" }]);
    const result = await exportCsv(ctx, input(), source as never);
    expect(result.content).toBe("﻿Nombre,Total\r\n'=HYPERLINK(1),-5.00\r\n");
  });

  it("names the file after the entity and the Caracas date of ctx.now", async () => {
    const { source } = makeSource(rows(1));
    // 02:00 UTC on the 10th is still the 9th in Caracas (UTC-4).
    const late = { ...ctx, now: new Date("2026-10-10T02:00:00.000Z") };
    expect((await exportCsv(late, input(), source as never)).filename).toBe(
      "client-2026-10-09.csv",
    );
    expect((await exportCsv(ctx, input(), source as never)).filename).toBe(
      `client-${FIXED_NOW.toISOString().slice(0, 10)}.csv`,
    );
  });

  it("returns only the header when nothing matches", async () => {
    const { source } = makeSource([]);
    const result = await exportCsv(ctx, input(), source as never);
    expect(result).toMatchObject({ content: "﻿Nombre,Total\r\n", rowCount: 0 });
  });
});
