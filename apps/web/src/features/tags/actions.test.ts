import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);
vi.mock("next-intl/server", () => intl);

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import type { ExportCsvInputRaw } from "@/lib/validators/export";
import {
  assignTagsAction,
  createTagAction,
  exportTagsCsvAction,
  listTagsAction,
  unassignTagAction,
  updateTagAction,
} from "./actions";

const tag = {
  id: "tag_ur",
  name: "Urgente",
  color: "#ff0000",
  usageCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const chip = { id: "tag_ur", name: "Urgente", color: "#ff0000" };

beforeEach(() => {
  cache.revalidatePath.mockReset();
  cache.updateTag.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createTagAction", () => {
  it("creates a tag through POST /api/v1/tags and refreshes the Settings table", async () => {
    const { api, calls } = mockApi({ "POST /api/v1/tags": { status: 201, body: tag } });
    server.getServerApi.mockResolvedValue(api);

    expect(await createTagAction({ name: "Urgente", color: "#ff0000" })).toEqual({
      ok: true,
      data: tag,
    });
    expect(calls[0]?.body).toEqual({ name: "Urgente", color: "#ff0000" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/tags");
  });

  it("answers CONFLICT with the existing tag as the entity and revalidates nothing", async () => {
    const { api } = mockApi({
      "POST /api/v1/tags": errorEnvelope("CONFLICT", {
        entity: { type: "TAG", id: tag.id, code: null, label: tag.name },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    expect(await createTagAction({ name: "urgente", color: "#ff0000" })).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CONFLICT",
        entity: { type: "TAG", id: tag.id, label: tag.name },
      }),
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps the field keys the BE returns onto the field errors", async () => {
    const { api } = mockApi({
      "POST /api/v1/tags": errorEnvelope("VALIDATION", {
        fieldErrors: { color: ["validation.invalidFormat"] },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    expect(await createTagAction({ name: "Urgente", color: "rojo" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { color: ["validation.invalidFormat"] } },
    });
  });

  it("maps FORBIDDEN when the BE refuses the caller", async () => {
    const { api } = mockApi({ "POST /api/v1/tags": errorEnvelope("FORBIDDEN") });
    server.getServerApi.mockResolvedValue(api);

    expect(await createTagAction({ name: "Lector", color: "#123456" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateTagAction", () => {
  it("renames and recolours through PATCH /api/v1/tags/{id} without the id in the body", async () => {
    const { api, calls } = mockApi({
      "PATCH /api/v1/tags/{id}": { body: { ...tag, color: "#abcdef" } },
    });
    server.getServerApi.mockResolvedValue(api);

    expect(await updateTagAction({ id: tag.id, color: "#abcdef" })).toMatchObject({
      ok: true,
      data: { id: tag.id, color: "#abcdef" },
    });
    expect(calls[0]?.path).toBe("/api/v1/tags/tag_ur");
    expect(calls[0]?.body).toEqual({ color: "#abcdef" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/tags");
  });

  it("answers CONFLICT with the field key when the new name is taken", async () => {
    const { api } = mockApi({
      "PATCH /api/v1/tags/{id}": errorEnvelope("CONFLICT", {
        fieldErrors: { name: ["tags.errors.nameTaken"] },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    expect(await updateTagAction({ id: tag.id, name: "Prioridad" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", fieldErrors: { name: ["tags.errors.nameTaken"] } },
    });
  });

  it("answers NOT_FOUND for a tag that no longer exists", async () => {
    const { api } = mockApi({ "PATCH /api/v1/tags/{id}": errorEnvelope("NOT_FOUND") });
    server.getServerApi.mockResolvedValue(api);

    expect(await updateTagAction({ id: "tag_gone", color: "#abcdef" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("assignTagsAction", () => {
  it("tags an entity through POST /api/v1/tags/assign and returns the chips", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/tags/assign": { body: { items: [chip] } },
    });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await assignTagsAction({ entityType: "PROJECT", entityId: "prj_1", tagIds: [tag.id] }),
    ).toEqual({ ok: true, data: [chip] });
    expect(calls[0]?.body).toEqual({ entityType: "PROJECT", entityId: "prj_1", tagIds: [tag.id] });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/tags");
  });

  it("maps FORBIDDEN when a Member tags a client, and changes nothing", async () => {
    const { api } = mockApi({ "POST /api/v1/tags/assign": errorEnvelope("FORBIDDEN") });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await assignTagsAction({ entityType: "CLIENT", entityId: "cli_1", tagIds: [tag.id] }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps the VALIDATION key of an unknown tag id", async () => {
    const { api } = mockApi({
      "POST /api/v1/tags/assign": errorEnvelope("VALIDATION", {
        fieldErrors: { tagIds: ["validation.invalidOption"] },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await assignTagsAction({ entityType: "PROJECT", entityId: "prj_1", tagIds: ["tag_missing"] }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { tagIds: ["validation.invalidOption"] } },
    });
  });

  it("maps NOT_FOUND for an unknown entity", async () => {
    const { api } = mockApi({ "POST /api/v1/tags/assign": errorEnvelope("NOT_FOUND") });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await assignTagsAction({ entityType: "PROJECT", entityId: "prj_gone", tagIds: [tag.id] }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("unassignTagAction", () => {
  it("removes one tag through POST /api/v1/tags/unassign", async () => {
    const { api, calls } = mockApi({ "POST /api/v1/tags/unassign": { body: { items: [] } } });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await unassignTagAction({ entityType: "PROJECT", entityId: "prj_1", tagId: tag.id }),
    ).toEqual({ ok: true, data: [] });
    expect(calls[0]?.body).toEqual({ entityType: "PROJECT", entityId: "prj_1", tagId: tag.id });
  });

  it("maps FORBIDDEN when a Member untags a client", async () => {
    const { api } = mockApi({ "POST /api/v1/tags/unassign": errorEnvelope("FORBIDDEN") });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await unassignTagAction({ entityType: "CLIENT", entityId: "cli_1", tagId: tag.id }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("listTagsAction", () => {
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
