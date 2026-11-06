import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { getMockStore } from "@/mocks/store";
import type { ExportCsvInputRaw } from "@/lib/validators/export";
import { makeSessionUser } from "@/mocks/test-helpers";
import type { UserRole } from "@/lib/validators/enums";
import {
  assignTagsAction,
  createTagAction,
  exportTagsCsvAction,
  listTagsAction,
  unassignTagAction,
  updateTagAction,
} from "./actions";

const signIn = (role: UserRole) =>
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: "usr_actor" }));

/** Fixtures of the dataset: an active client, an active project and the first two tags. */
const fixtures = () => {
  const db = getMockStore();
  return {
    client: db.clients.find((row) => !row.archivedAt)!,
    project: db.projects.find((row) => !row.archivedAt)!,
    tags: db.tags,
  };
};

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("createTagAction", () => {
  it("lets an Owner create a tag from the settings", async () => {
    signIn("OWNER");
    expect(await createTagAction({ name: "Prioridad alta", color: "#123456" })).toMatchObject({
      ok: true,
      data: { name: "Prioridad alta", color: "#123456", usageCount: 0 },
    });
  });

  it("lets a Member create one inline from a note or a project (any-of grants)", async () => {
    signIn("MEMBER");
    expect(await createTagAction({ name: "Inline miembro", color: "#123456" })).toMatchObject({
      ok: true,
    });
  });

  it("refuses a Viewer", async () => {
    signIn("VIEWER");
    expect(await createTagAction({ name: "Lector", color: "#123456" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(getMockStore().tags.some((tag) => tag.name === "Lector")).toBe(false);
  });

  it("answers CONFLICT with the existing tag as the entity", async () => {
    signIn("OWNER");
    const existing = fixtures().tags[0]!;
    expect(await createTagAction({ name: existing.name.toUpperCase(), color: "#000000" })).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CONFLICT",
        entity: { type: "TAG", id: existing.id, label: existing.name },
      }),
    });
  });

  it("requires a session and a valid colour", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await createTagAction({ name: "Sin sesión", color: "#123456" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    signIn("OWNER");
    expect(await createTagAction({ name: "Color roto", color: "rojo" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});

describe("updateTagAction", () => {
  it("lets an Owner rename and recolour a tag", async () => {
    signIn("OWNER");
    const tag = fixtures().tags[0]!;
    expect(await updateTagAction({ id: tag.id, color: "#abcdef" })).toMatchObject({
      ok: true,
      data: { id: tag.id, color: "#abcdef" },
    });
  });

  it("refuses a Member: the catalogue is settings (Owner and Admin)", async () => {
    signIn("MEMBER");
    const tag = fixtures().tags[0]!;
    expect(await updateTagAction({ id: tag.id, color: "#abcdef" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(getMockStore().tags.find((row) => row.id === tag.id)?.color).toBe(tag.color);
  });

  it("validates the input before the service runs", async () => {
    signIn("OWNER");
    expect(await updateTagAction({ id: "../tag", color: "#abcdef" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});

describe("assignTagsAction", () => {
  it("lets a Member tag a project", async () => {
    signIn("MEMBER");
    const { project, tags } = fixtures();
    expect(
      await assignTagsAction({
        entityType: "PROJECT",
        entityId: project.id,
        tagIds: [tags[0]!.id],
      }),
    ).toMatchObject({ ok: true, data: [expect.objectContaining({ id: tags[0]!.id })] });
    expect(getMockStore().projects.find((row) => row.id === project.id)?.tagIds).toContain(
      tags[0]!.id,
    );
  });

  it("refuses a Member on a client with FORBIDDEN from the service check, and writes nothing", async () => {
    signIn("MEMBER");
    const { client, tags } = fixtures();
    const before = [...(client.tagIds ?? [])];
    expect(
      await assignTagsAction({ entityType: "CLIENT", entityId: client.id, tagIds: [tags[0]!.id] }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(client.tagIds ?? []).toEqual(before);
  });

  it("refuses a Viewer at the gate", async () => {
    signIn("VIEWER");
    const { project, tags } = fixtures();
    expect(
      await assignTagsAction({
        entityType: "PROJECT",
        entityId: project.id,
        tagIds: [tags[0]!.id],
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("answers VALIDATION for a bad entity type or an empty tag list", async () => {
    signIn("OWNER");
    const { project, tags } = fixtures();
    expect(
      await assignTagsAction({
        entityType: "NOT_A_TYPE" as never,
        entityId: project.id,
        tagIds: [tags[0]!.id],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(
      await assignTagsAction({ entityType: "PROJECT", entityId: project.id, tagIds: [] }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("answers NOT_FOUND for an unknown tag and keeps the entity's tags", async () => {
    signIn("OWNER");
    const { project } = fixtures();
    const before = [...(project.tagIds ?? [])];
    expect(
      await assignTagsAction({
        entityType: "PROJECT",
        entityId: project.id,
        tagIds: ["tag_missing"],
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(project.tagIds ?? []).toEqual(before);
  });
});

describe("unassignTagAction", () => {
  it("lets a Member untag a project and refuses the same on a client", async () => {
    signIn("MEMBER");
    const { project, client, tags } = fixtures();
    project.tagIds = [tags[0]!.id];
    client.tagIds = [tags[0]!.id];
    expect(
      await unassignTagAction({ entityType: "PROJECT", entityId: project.id, tagId: tags[0]!.id }),
    ).toMatchObject({ ok: true, data: [] });
    expect(
      await unassignTagAction({ entityType: "CLIENT", entityId: client.id, tagId: tags[0]!.id }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("listTagsAction", () => {
  const tag = {
    id: "tag_ur",
    name: "Urgente",
    color: "#ff0000",
    usageCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it('is reference data: every signed-in role reads GET /api/v1/tags ("authenticated")', async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/tags": { body: { items: [tag], total: 1, page: 1, pageSize: 25, pageCount: 1 } },
    });
    server.getServerApi.mockResolvedValue(api);
    expect(await listTagsAction({ pageSize: 25, q: "ur" })).toEqual({
      ok: true,
      data: { items: [tag], total: 1, page: 1, pageSize: 25, pageCount: 1 },
    });
    expect(calls[0]?.search.get("q")).toBe("ur");
  });

  it("maps the UNAUTHENTICATED envelope the BE sends without a session", async () => {
    const { api } = mockApi({ "GET /api/v1/tags": errorEnvelope("UNAUTHENTICATED") });
    server.getServerApi.mockResolvedValue(api);
    expect(await listTagsAction({ pageSize: 25 })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", redirectTo: "/sign-in" },
    });
  });

  it("answers VALIDATION for a page size the table cannot send, without calling the BE", async () => {
    const { api, calls } = mockApi({});
    server.getServerApi.mockResolvedValue(api);
    expect(await listTagsAction({ pageSize: 33 as never })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });
});

describe("exportTagsCsvAction", () => {
  /** Routes the server client of the export action to an HTTP double of `POST /exports/TAG`. */
  function exportApi(response?: () => Response) {
    const mocked = mockApi({
      "POST /api/v1/exports/TAG":
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

  const errorResponse = (code: Parameters<typeof errorEnvelope>[0]) => () => {
    const { status, body } = errorEnvelope(code);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  const input: ExportCsvInputRaw = {
    entity: "TAG",
    query: { page: 1, pageSize: 25 },
    columns: ["name", "usageCount"],
  };

  it("posts the visible columns, translated labels and the query to /exports/TAG", async () => {
    const { calls } = exportApi();
    expect(await exportTagsCsvAction(input)).toMatchObject({
      ok: true,
      data: { rowCount: 2, truncated: false },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      columns: [
        { id: "name", label: expect.stringMatching(/^tags:.*name$/) },
        { id: "usageCount", label: expect.stringMatching(/^tags:.*usageCount$/) },
      ],
      query: { archived: "exclude", filters: {} },
    });
  });

  it("maps the FORBIDDEN envelope the BE sends to Member and Viewer", async () => {
    exportApi(errorResponse("FORBIDDEN"));
    expect(await exportTagsCsvAction(input)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
