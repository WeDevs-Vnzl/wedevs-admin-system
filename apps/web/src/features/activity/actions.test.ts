import { beforeEach, describe, expect, it, vi } from "vitest";

const intl = vi.hoisted(() => ({
  // Resolves the activity column labels from the Spanish catalogue, as the request locale would.
  getTranslations: vi.fn(
    async () => (key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          esMessages,
        ) as string,
  ),
}));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next-intl/server", () => intl);

import esMessages from "@/i18n/messages/es/activity.json";
import { errorEnvelope, mockApi, type RouteHandler } from "@/lib/api/testing";
import { activityFilterSchema } from "@/lib/validators/activity";
import { exportActivityCsvAction, listActivityAction } from "./actions";
import { ACTIVITY_EXPORT_COLUMNS, activityExportQuery } from "./columns";

/** Routes the server client of the actions to an HTTP double of the activity endpoints. */
function activityApi(route: RouteHandler) {
  const mocked = mockApi({ "GET /api/v1/activity": route });
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

const onePage = {
  items: [
    {
      id: "act_0042",
      actor: { type: "USER", id: "usr_ana", name: "Ana Torres", imageUrl: null },
      action: "STATUS_CHANGE",
      entityType: "PROJECT",
      entityId: "prj_portal",
      entityLabel: "Portal de clientes",
      changes: { status: ["PROPUESTA", "EN_CURSO"] },
      metadata: null,
      ip: "192.0.2.•••",
      userAgent: null,
      createdAt: "2026-10-09T15:00:00.000Z",
    },
  ],
  page: 2,
  pageCount: 3,
  pageSize: 25,
  total: 60,
};

beforeEach(() => {
  server.getServerApi.mockReset();
});

describe("listActivityAction", () => {
  it("reads one page of the log from GET /activity with the filter as query params", async () => {
    const { calls } = activityApi({ body: onePage });
    const result = await listActivityAction({
      pageSize: 25,
      page: 2,
      actorType: "USER",
      from: "2026-10-01",
    });
    expect(result).toEqual({ ok: true, data: onePage });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.search.get("page")).toBe("2");
    expect(calls[0]?.search.get("pageSize")).toBe("25");
    expect(calls[0]?.search.getAll("actorType")).toEqual(["USER"]);
    expect(calls[0]?.search.get("from")).toBe("2026-10-01");
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "gets the FORBIDDEN envelope of the BE for %s (no read of activity)",
    async () => {
      activityApi(errorEnvelope("FORBIDDEN"));
      expect(await listActivityAction({})).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    },
  );

  it("rejects an invalid date range with VALIDATION before any call", async () => {
    const { calls } = activityApi({ body: onePage });
    expect(await listActivityAction({ from: "2026-10-09", to: "2026-10-01" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });
});

describe("exportActivityCsvAction", () => {
  const columns = Object.keys(ACTIVITY_EXPORT_COLUMNS);

  /** Routes the server client of the export action to an HTTP double of `POST /exports/ACTIVITY`. */
  function exportApi(response?: () => Response) {
    const mocked = mockApi({
      "POST /api/v1/exports/ACTIVITY":
        response ??
        (() =>
          new Response("h\r\n", {
            status: 200,
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "X-Export-Row-Count": "2",
              "X-Export-Truncated": "false",
            },
          })),
    });
    server.getServerApi.mockResolvedValue(mocked.api);
    return mocked;
  }

  it("posts the translated columns and the filtered query to /exports/ACTIVITY", async () => {
    const { calls } = exportApi();
    const result = await exportActivityCsvAction({
      entity: "ACTIVITY",
      query: activityExportQuery(
        activityFilterSchema.parse({ actorType: ["SYSTEM"], from: "2026-10-01", to: "2026-10-09" }),
      ),
      columns,
    });
    expect(result).toMatchObject({ ok: true, data: { rowCount: 2, truncated: false } });
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as { columns: { id: string; label: string }[]; query: object };
    expect(body.columns.map((c) => c.id)).toEqual(columns);
    expect(body.columns.map((c) => c.label)).toEqual([
      "Fecha",
      "Usuario",
      "Acción",
      "Tipo de registro",
      "Registro",
      "ID del registro",
    ]);
    expect(body.query).toMatchObject({
      archived: "exclude",
      filters: { actorType: "SYSTEM", from: "2026-10-01", to: "2026-10-09" },
    });
  });

  it("keeps the IP and the user agent out of the exported columns (C5)", async () => {
    const { calls } = exportApi();
    await exportActivityCsvAction({
      entity: "ACTIVITY",
      query: activityExportQuery(activityFilterSchema.parse({})),
      columns,
    });
    expect(JSON.stringify(calls[0]?.body)).not.toMatch(/"id":"(ip|userAgent)"/);
  });

  it("maps the FORBIDDEN envelope of the BE to an error result", async () => {
    exportApi(
      () =>
        new Response(JSON.stringify(errorEnvelope("FORBIDDEN").body), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(
      await exportActivityCsvAction({
        entity: "ACTIVITY",
        query: activityExportQuery(activityFilterSchema.parse({})),
        columns: ["createdAt"],
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("refuses a column id outside the activity columns with VALIDATION", async () => {
    const { calls } = exportApi();
    expect(
      await exportActivityCsvAction({
        entity: "ACTIVITY",
        query: activityExportQuery(activityFilterSchema.parse({})),
        columns: [],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(calls).toHaveLength(0);
  });
});

describe("activityExportQuery", () => {
  it("maps the filter to the table query with the date facet and no entity pair", () => {
    const query = activityExportQuery(
      activityFilterSchema.parse({
        actorType: "USER",
        action: ["UPDATE"],
        from: "2026-10-01",
        to: "2026-10-09",
      }),
    );
    expect(query.filters).toEqual({
      actorType: ["USER"],
      action: ["UPDATE"],
      date: ["2026-10-01", "2026-10-09"],
    });
    expect(query).toMatchObject({ page: 1, pageSize: 25, includeArchived: false });
  });

  it("keeps the export columns free of the IP and the user agent (C5, PRD §8.14)", () => {
    expect(Object.keys(ACTIVITY_EXPORT_COLUMNS)).toEqual([
      "createdAt",
      "actor",
      "action",
      "entityType",
      "entityLabel",
      "entityId",
    ]);
  });
});
