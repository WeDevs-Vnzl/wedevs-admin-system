import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);

import { listQuerySchema, paginated } from "@/lib/validators/common";
import type { ExportSource } from "@/lib/validators/export";
import { makeSessionUser } from "@/mocks/test-helpers";
import { defineCsvExportAction } from "./define-csv-export-action";

type Row = { name: string };
const source: ExportSource<Row, never, never> = {
  entity: "CLIENT",
  facets: [],
  filterSchema: listQuerySchema.omit({ filters: true }) as never,
  list: async (_ctx, filter) => paginated([{ name: "Acme" }], 1, filter as never),
  columns: { name: { labelKey: "name", value: (r) => r.name } },
};

// The real service is injected by the module; here it echoes the translated source back.
const exportCsv = vi.fn(
  async (_ctx: unknown, _input: unknown, src: ExportSource<Row, never, never>) => ({
    filename: "client-2026-10-09.csv",
    content: `${src.columns.name!.labelKey}\r\n`,
    rowCount: 1,
    truncated: false,
  }),
);

function build() {
  return defineCsvExportAction({
    entity: "CLIENT",
    permission: { action: "read", resource: "client" },
    source: source as never,
    exportCsv: exportCsv as never,
    namespace: "clients.table.columns",
  });
}

const payload = { entity: "CLIENT" as const, query: {}, columns: ["name"] };

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  exportCsv.mockClear();
});

describe("defineCsvExportAction", () => {
  it("translates each column's labelKey with the namespace before calling the service", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const result = await build()(payload);
    expect(intl.getTranslations).toHaveBeenCalledWith("clients.table.columns");
    expect(result).toMatchObject({
      ok: true,
      data: { content: "clients.table.columns:name\r\n", rowCount: 1 },
    });
  });

  it("refuses a Member on { read, activity } with FORBIDDEN and never calls the service", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    const action = defineCsvExportAction({
      entity: "ACTIVITY",
      permission: { action: "read", resource: "activity" },
      source: { ...source, entity: "ACTIVITY" } as never,
      exportCsv: exportCsv as never,
      namespace: "activity.table.columns",
    });
    expect(await action({ ...payload, entity: "ACTIVITY" as const })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(exportCsv).not.toHaveBeenCalled();
  });

  it("narrows the input to its entity and requires columns", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const action = build() as (input: unknown) => Promise<unknown>;
    expect(await action({ ...payload, entity: "PROJECT" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await action({ ...payload, columns: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("fails fast when the source belongs to another entity", () => {
    expect(() =>
      defineCsvExportAction({
        entity: "PROJECT",
        permission: { action: "read", resource: "project" },
        source: source as never,
        exportCsv: exportCsv as never,
        namespace: "x",
      }),
    ).toThrow(/CLIENT/);
  });

  it("never imports the mocks (C9)", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("./define-csv-export-action.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/from\s+["']@\/mocks/);
  });
});
