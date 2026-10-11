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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);

import esMessages from "@/i18n/messages/es/activity.json";
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
  it("writes the filtered rows with translated headers, no IP column, BOM and CRLF", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const result = await exportActivityCsvAction({
      entity: "ACTIVITY",
      query: activityExportQuery(activityFilterSchema.parse({ actorType: ["SYSTEM"] })),
      columns: Object.keys(ACTIVITY_EXPORT_COLUMNS),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [header] = result.data.content.replace(/^﻿/, "").split("\r\n");
    expect(result.data.content.startsWith("﻿")).toBe(true);
    expect(header).toBe("Fecha,Usuario,Acción,Tipo de registro,Registro,ID del registro");
    expect(result.data.content).not.toMatch(/192\.0\.2\./);
    expect(result.data.rowCount).toBeGreaterThan(0);
    expect(result.data.filename).toMatch(/^activity-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("applies the date facet as the Caracas range (from / to)", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const all = await exportActivityCsvAction({
      entity: "ACTIVITY",
      query: activityExportQuery(activityFilterSchema.parse({})),
      columns: ["createdAt"],
    });
    const none = await exportActivityCsvAction({
      entity: "ACTIVITY",
      query: activityExportQuery(
        activityFilterSchema.parse({ from: "2001-01-01", to: "2001-01-02" }),
      ),
      columns: ["createdAt"],
    });
    expect(all.ok && none.ok && all.data.rowCount > none.data.rowCount).toBe(true);
    expect(none.ok && none.data.rowCount).toBe(0);
  });

  it("refuses Member with FORBIDDEN", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    expect(
      await exportActivityCsvAction({
        entity: "ACTIVITY",
        query: activityExportQuery(activityFilterSchema.parse({})),
        columns: ["createdAt"],
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("refuses a column id outside the activity columns with VALIDATION", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    expect(
      await exportActivityCsvAction({
        entity: "ACTIVITY",
        query: activityExportQuery(activityFilterSchema.parse({})),
        columns: ["ip"],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
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
