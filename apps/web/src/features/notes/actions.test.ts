import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { RichTextDoc } from "@/lib/validators/notes";
import {
  archiveNoteAction,
  attachFileAction,
  createNoteAction,
  exportNotesCsvAction,
  getNoteAction,
  linkNoteAction,
  listNotesAction,
  pinNoteAction,
  restoreNoteAction,
  unlinkNoteAction,
  updateNoteAction,
} from "./actions";

const doc: RichTextDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Una nota de prueba" }] }],
};
const clientLink = { entityType: "CLIENT", entityId: "cli_kairos" } as const;
const projectLink = { entityType: "PROJECT", entityId: "pry_web" } as const;

const file = (id: string) => ({
  id,
  originalName: `${id}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 10,
  status: "READY",
  uploadedById: "usr_1",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const wire = (overrides: Record<string, unknown> = {}) => ({
  id: "note_1",
  title: "Alcance",
  content: doc,
  contentText: "Una nota de prueba",
  author: { id: "usr_1", name: "Ana", imageUrl: null },
  pinned: false,
  tags: [{ id: "tag_1", name: "Urgente", color: "#ff0000" }],
  links: [
    { type: "CLIENT", id: "cli_kairos", label: "Kairos", code: "CLI-1" },
    { type: "PROJECT", id: "pry_web", label: "Web", code: null },
  ],
  attachments: [file("fil_a"), file("fil_b")],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  ...overrides,
});

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  cache.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("createNoteAction", () => {
  it("creates a note with tags, two attachments and client + project links (HU-23 CA1-CA2)", async () => {
    const { calls } = useApi({ "POST /api/v1/notes": { status: 201, body: wire() } });

    const result = await createNoteAction({
      title: "Alcance",
      content: doc,
      links: [clientLink, projectLink],
      tagIds: ["tag_1"],
      attachmentFileIds: ["fil_a", "fil_b"],
    });

    expect(calls[0]?.body).toEqual({
      title: "Alcance",
      content: doc,
      links: [clientLink, projectLink],
      pinned: false,
      tagIds: ["tag_1"],
      attachmentFileIds: ["fil_a", "fil_b"],
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        id: "note_1",
        tags: [{ id: "tag_1" }],
        attachments: [{ id: "fil_a" }, { id: "fil_b" }],
        links: [
          { type: "CLIENT", id: "cli_kairos" },
          { type: "PROJECT", id: "pry_web" },
        ],
      },
    });
    // The wire `null` code of a link is parsed away (entityRefSchema).
    expect(result.ok && result.data.links[1]).toEqual({
      type: "PROJECT",
      id: "pry_web",
      label: "Web",
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/notes");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients/cli_kairos");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects/pry_web");
  });

  it("sends the uploaded images of the content as attachments (pasted image -> fileId node)", async () => {
    const withImage: RichTextDoc = {
      type: "doc",
      content: [{ type: "image", attrs: { fileId: "fil_img", alt: "captura.png" } }],
    };
    const { calls } = useApi({ "POST /api/v1/notes": { status: 201, body: wire() } });

    await createNoteAction({
      content: withImage,
      links: [clientLink],
      attachmentFileIds: ["fil_img"],
    });

    expect(calls[0]?.body).toMatchObject({
      content: withImage,
      attachmentFileIds: ["fil_img"],
    });
  });

  it("maps a 422 for <script> content to a VALIDATION result with its field errors", async () => {
    useApi({
      "POST /api/v1/notes": errorEnvelope("VALIDATION", {
        message: "validation.invalidFormat",
        fieldErrors: { content: ["validation.invalidFormat"] },
      }),
    });
    const hostile = { type: "doc", content: [{ type: "script" }] } as unknown as RichTextDoc;

    expect(await createNoteAction({ content: hostile, links: [clientLink] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { content: ["validation.invalidFormat"] } },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a link to an unknown (or mock-only) record to NOT_FOUND", async () => {
    useApi({ "POST /api/v1/notes": errorEnvelope("NOT_FOUND") });
    expect(
      await createNoteAction({
        content: doc,
        links: [{ entityType: "INVOICE", entityId: "inv_mock" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("maps FORBIDDEN for a Viewer", async () => {
    useApi({ "POST /api/v1/notes": errorEnvelope("FORBIDDEN") });
    expect(await createNoteAction({ content: doc, links: [clientLink] })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("update / pin / link / unlink / attach", () => {
  it("updates title, content and tags through PATCH /notes/{id}", async () => {
    const { calls } = useApi({ "PATCH /api/v1/notes/{id}": { body: wire({ title: "Nuevo" }) } });
    expect(
      await updateNoteAction({ id: "note_1", title: "Nuevo", content: doc, tagIds: ["tag_1"] }),
    ).toMatchObject({ ok: true, data: { title: "Nuevo" } });
    expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/v1/notes/note_1" });
    expect(calls[0]?.body).toEqual({ title: "Nuevo", content: doc, tagIds: ["tag_1"] });
  });

  it("pins a note through POST /notes/{id}/pin", async () => {
    const { calls } = useApi({ "POST /api/v1/notes/{id}/pin": { body: wire({ pinned: true }) } });
    expect(await pinNoteAction({ id: "note_1", pinned: true })).toMatchObject({
      ok: true,
      data: { pinned: true },
    });
    expect(calls[0]?.path).toBe("/api/v1/notes/note_1/pin");
    expect(calls[0]?.body).toEqual({ pinned: true });
  });

  it("links a note to one more record and refreshes that record's Notas tab", async () => {
    const { calls } = useApi({ "POST /api/v1/notes/{id}/links": { body: wire() } });
    expect(await linkNoteAction({ noteId: "note_1", target: projectLink })).toMatchObject({
      ok: true,
    });
    expect(calls[0]?.path).toBe("/api/v1/notes/note_1/links");
    expect(calls[0]?.body).toEqual(projectLink);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects/pry_web");
  });

  it("maps a link to an unknown id to NOT_FOUND", async () => {
    useApi({ "POST /api/v1/notes/{id}/links": errorEnvelope("NOT_FOUND") });
    expect(
      await linkNoteAction({
        noteId: "note_1",
        target: { entityType: "CLIENT", entityId: "cli_nope" },
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("unlinks through POST /notes/{id}/unlink and refreshes the record that lost the note", async () => {
    const { calls } = useApi({
      "POST /api/v1/notes/{id}/unlink": { body: wire({ links: [wire().links[0]] }) },
    });
    expect(await unlinkNoteAction({ noteId: "note_1", target: projectLink })).toMatchObject({
      ok: true,
      data: { links: [{ id: "cli_kairos" }] },
    });
    expect(calls[0]?.path).toBe("/api/v1/notes/note_1/unlink");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects/pry_web");
  });

  it("answers INTEGRITY_LOCK when the last link would go", async () => {
    useApi({ "POST /api/v1/notes/{id}/unlink": errorEnvelope("INTEGRITY_LOCK") });
    expect(await unlinkNoteAction({ noteId: "note_1", target: clientLink })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK" },
    });
  });

  it("attaches a confirmed file with { fileId } and answers NOT_FOUND for a PENDING one", async () => {
    const { calls } = useApi({
      "POST /api/v1/notes/{id}/attachments": (call) =>
        (call.body as { fileId: string }).fileId === "fil_pending"
          ? errorEnvelope("NOT_FOUND")
          : { status: 201, body: wire() },
    });
    expect(await attachFileAction({ noteId: "note_1", fileId: "fil_a" })).toMatchObject({
      ok: true,
      data: { attachments: [{ id: "fil_a" }, { id: "fil_b" }] },
    });
    expect(calls[0]?.body).toEqual({ fileId: "fil_a" });
    expect(await attachFileAction({ noteId: "note_1", fileId: "fil_pending" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("maps FORBIDDEN on every write for a Viewer", async () => {
    useApi({
      "PATCH /api/v1/notes/{id}": errorEnvelope("FORBIDDEN"),
      "POST /api/v1/notes/{id}/pin": errorEnvelope("FORBIDDEN"),
    });
    expect(await updateNoteAction({ id: "note_1", content: doc })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await pinNoteAction({ id: "note_1", pinned: false })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("archiveNoteAction (own-records grant, PRD §4.3)", () => {
  it("archives through POST /notes/{id}/archive and refreshes the table", async () => {
    const { calls } = useApi({
      "POST /api/v1/notes/{id}/archive": {
        body: { id: "note_own", archivedAt: "2026-02-01T00:00:00.000Z" },
      },
    });
    expect(await archiveNoteAction({ id: "note_own" })).toMatchObject({
      ok: true,
      data: { id: "note_own" },
    });
    expect(calls[0]?.path).toBe("/api/v1/notes/note_own/archive");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/notes");
  });

  it("a Member archiving another user's note gets the BE's FORBIDDEN and nothing is refreshed", async () => {
    useApi({ "POST /api/v1/notes/{id}/archive": errorEnvelope("FORBIDDEN") });
    expect(await archiveNoteAction({ id: "note_other" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps NOT_FOUND for an unknown id", async () => {
    useApi({ "POST /api/v1/notes/{id}/archive": errorEnvelope("NOT_FOUND") });
    expect(await archiveNoteAction({ id: "note_nope" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("restoreNoteAction", () => {
  it("restores through POST /notes/{id}/restore", async () => {
    const { calls } = useApi({
      "POST /api/v1/notes/{id}/restore": {
        body: { type: "NOTE", id: "note_1", label: "Alcance", code: null },
      },
    });
    expect(await restoreNoteAction({ id: "note_1" })).toMatchObject({
      ok: true,
      data: { id: "note_1" },
    });
    expect(calls[0]?.path).toBe("/api/v1/notes/note_1/restore");
  });
});

describe("read actions", () => {
  it("lists a feed through GET /notes with the entity filter and maps the rows", async () => {
    const { calls } = useApi({
      "GET /api/v1/notes": {
        body: {
          items: [
            {
              id: "note_1",
              title: null,
              excerpt: "Hola",
              author: wire().author,
              pinned: true,
              tags: [],
              links: wire().links,
              attachmentCount: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              archivedAt: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        },
      },
    });
    const feed = await listNotesAction({
      entityType: "PROJECT",
      entityId: "pry_web",
      pageSize: 25,
    });
    expect(feed.ok && feed.data.items.map((row) => row.id)).toEqual(["note_1"]);
    expect(calls[0]?.search.get("entityId")).toBe("pry_web");
    expect(calls[0]?.search.get("archived")).toBe("exclude");
  });

  it("refuses an entity type without id before calling the BE", async () => {
    const { calls } = useApi({});
    expect(await listNotesAction({ entityType: "PROJECT" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });

  it("gets one note through GET /notes/{id}", async () => {
    useApi({ "GET /api/v1/notes/{id}": { body: wire() } });
    expect(await getNoteAction({ id: "note_1" })).toMatchObject({
      ok: true,
      data: { id: "note_1" },
    });
  });
});

/** Routes the server client of the export action to an HTTP double of `POST /exports/NOTE`. */
function exportApi(response?: () => Response) {
  const mocked = mockApi({
    "POST /api/v1/exports/NOTE":
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

describe("export action", () => {
  it("exports the notes table through /exports/NOTE with the visible columns and translated labels", async () => {
    const { calls } = exportApi();
    const result = await exportNotesCsvAction({
      entity: "NOTE",
      query: { filters: { tagId: "tag_urgente" } },
      columns: ["title", "author", "pinned"],
    });
    expect(intl.getTranslations).toHaveBeenCalledWith("notes");
    expect(result).toMatchObject({ ok: true, data: { rowCount: 2 } });
    expect(calls[0]?.body).toEqual({
      columns: [
        { id: "title", label: "notes:columns.title" },
        { id: "author", label: "notes:columns.author" },
        { id: "pinned", label: "notes:columns.pinned" },
      ],
      query: { archived: "exclude", filters: { tagId: "tag_urgente" } },
    });
  });

  it("maps the FORBIDDEN envelope of the notes export and rejects an empty column list", async () => {
    const { calls } = exportApi(errorResponse("FORBIDDEN"));
    expect(
      await exportNotesCsvAction({ entity: "NOTE", query: {}, columns: ["title"] }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await exportNotesCsvAction({ entity: "NOTE", query: {}, columns: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(1);
  });
});
