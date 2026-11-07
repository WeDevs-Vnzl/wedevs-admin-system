import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next-intl/server", () => intl);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { CSV_BOM } from "@/lib/csv";
import { listQuerySchema } from "@/lib/validators/common";
import type { ExportSource } from "@/lib/validators/export";
import { defineCsvExportAction } from "./define-csv-export-action";

type Row = { name: string };
const source: ExportSource<Row, never> = {
  entity: "CLIENT",
  facets: [],
  filterSchema: listQuerySchema.omit({ filters: true }) as never,
  columns: {
    name: { labelKey: "name", value: (r) => r.name },
    email: { labelKey: "email", value: () => "" },
  },
};

function build(entity: string = "CLIENT") {
  return defineCsvExportAction({
    entity: entity as "CLIENT",
    source: { ...source, entity } as never,
    namespace: "clients.table.columns",
  }) as (input: unknown) => Promise<unknown>;
}

function setup(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

const csvOk = (headers: Record<string, string> = {}) =>
  new Response("Name\r\nAcme\r\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "X-Export-Row-Count": "1",
      "X-Export-Truncated": "false",
      ...headers,
    },
  });

const payload = {
  entity: "CLIENT",
  query: listQuerySchema.parse({ q: "ac", sort: "name:desc", filters: { status: ["ACTIVE"] } }),
  columns: ["name", "email"],
};

beforeEach(() => {
  server.getServerApi.mockReset();
});

describe("defineCsvExportAction", () => {
  it("posts the translated columns and the table query to /exports/{entity}", async () => {
    const { calls } = setup({ "POST /api/v1/exports/CLIENT": () => csvOk() });
    await build()(payload);
    expect(intl.getTranslations).toHaveBeenCalledWith("clients.table.columns");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      columns: [
        { id: "name", label: "clients.table.columns:name" },
        { id: "email", label: "clients.table.columns:email" },
      ],
      query: { archived: "exclude", q: "ac", sort: "name:desc", filters: { status: "ACTIVE" } },
    });
  });

  it("returns the CSV text with row count, truncated flag and the file name from the headers", async () => {
    setup({
      "POST /api/v1/exports/CLIENT": () =>
        csvOk({
          "X-Export-Row-Count": "10000",
          "X-Export-Truncated": "true",
          "Content-Disposition": 'attachment; filename="clients-2026-11-06.csv"',
        }),
    });
    expect(await build()(payload)).toEqual({
      ok: true,
      data: {
        filename: "clients-2026-11-06.csv",
        content: `${CSV_BOM}Name\r\nAcme\r\n`,
        rowCount: 10000,
        truncated: true,
      },
    });
  });

  it("keeps the UTF-8 BOM the BE writes: the returned CSV starts with CSV_BOM", async () => {
    // `Response.text()` decodes UTF-8 and drops a leading BOM, as it does on the real BE response.
    setup({
      "POST /api/v1/exports/CLIENT": () =>
        new Response(`${CSV_BOM}Name\r\nAcme\r\n`, {
          status: 200,
          headers: { "content-type": "text/csv; charset=utf-8", "X-Export-Row-Count": "1" },
        }),
    });
    const result = (await build()(payload)) as { data: { content: string } };
    expect(result.data.content.startsWith(CSV_BOM)).toBe(true);
    expect(result.data.content).toBe(`${CSV_BOM}Name\r\nAcme\r\n`);
  });

  it("falls back to <entity>-<date>.csv when Content-Disposition is missing", async () => {
    setup({ "POST /api/v1/exports/CLIENT": () => csvOk() });
    const result = (await build()(payload)) as { data: { filename: string; truncated: boolean } };
    expect(result.data.filename).toMatch(/^client-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.data.truncated).toBe(false);
  });

  it("maps an API error envelope to an error result", async () => {
    setup({ "POST /api/v1/exports/CLIENT": errorEnvelope("FORBIDDEN") });
    expect(await build()(payload)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("refuses an entity outside the generated path enum at definition time", () => {
    expect(() => build("CURRENCY")).toThrow(/CURRENCY/);
  });

  it("fails fast when the source belongs to another entity", () => {
    expect(() =>
      defineCsvExportAction({
        entity: "PROJECT",
        source: source as never,
        namespace: "x",
      }),
    ).toThrow(/CLIENT/);
  });

  it("narrows the input to its entity and requires columns", async () => {
    setup({});
    const action = build();
    expect(await action({ ...payload, entity: "PROJECT" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await action({ ...payload, columns: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
