import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
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
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);

import esMessages from "@/i18n/messages/es/activity.json";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makeSessionUser } from "@/mocks/test-helpers";
import { exportActivityCsvAction, listActivityAction } from "./actions";
import { ACTIVITY_EXPORT_COLUMNS, activityExportQuery } from "./columns";
import { activityFilterSchema } from "@/lib/validators/activity";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

describe("listActivityAction", () => {
  it("returns one page of the log, newest first, for Owner and Admin", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const result = await listActivityAction({ pageSize: 25, page: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.page).toBe(2);
    expect(result.data.items).toHaveLength(25);
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "refuses %s with FORBIDDEN (no read of activity)",
    async (role) => {
      session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
      expect(await listActivityAction({})).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    },
  );

  it("rejects an invalid date range with VALIDATION before the service runs", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    expect(await listActivityAction({ from: "2026-10-09", to: "2026-10-01" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
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
