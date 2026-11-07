import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("@/lib/api/server", () => server);

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getNote, getNotesViewer, listNotes } from "./queries";

const row = {
  id: "note_1",
  title: "T",
  excerpt: "Hola",
  author: { id: "usr_1", name: "Ana", imageUrl: null },
  pinned: true,
  tags: [],
  links: [{ type: "PROJECT", id: "pry_1", label: "Portal", code: "PRY-1" }],
  attachmentCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(
    makeSessionUser("MEMBER", { id: "usr_diego_paredes" }),
  );
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("notes queries", () => {
  it("lists the feed of a record through GET /api/v1/notes", async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/notes": {
        body: { items: [row], total: 1, page: 1, pageSize: 25, pageCount: 1 },
      },
    });
    server.getServerApi.mockResolvedValue(api);

    const page = await listNotes({ entityType: "PROJECT", entityId: "pry_1" });
    expect(page.items.map((item) => item.id)).toEqual(["note_1"]);
    expect(page.items[0]?.links[0]).toMatchObject({ type: "PROJECT", code: "PRY-1" });
    expect(calls[0]?.search.get("entityType")).toBe("PROJECT");
    expect(calls[0]?.search.get("entityId")).toBe("pry_1");
  });

  it("parses the filter: an entity type without id is refused before any call", async () => {
    const { api, calls } = mockApi({});
    server.getServerApi.mockResolvedValue(api);
    await expect(listNotes({ entityType: "PROJECT" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("throws when the list answers with an error envelope", async () => {
    const { api } = mockApi({ "GET /api/v1/notes": errorEnvelope("INTERNAL") });
    server.getServerApi.mockResolvedValue(api);
    await expect(listNotes()).rejects.toThrow("GET /api/v1/notes failed with 500");
  });

  it("gets a note and throws ServiceError NOT_FOUND on a 404", async () => {
    const { api } = mockApi({
      "GET /api/v1/notes/{id}": (call) =>
        call.path.endsWith("note_nope")
          ? errorEnvelope("NOT_FOUND")
          : {
              body: {
                ...row,
                content: { type: "doc", content: [{ type: "paragraph" }] },
                contentText: "",
                attachments: [],
              },
            },
    });
    server.getServerApi.mockResolvedValue(api);

    expect((await getNote({ id: "note_1" })).title).toBe("T");
    await expect(getNote({ id: "note_nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the viewer id and role", async () => {
    expect(await getNotesViewer()).toEqual({ id: "usr_diego_paredes", role: "MEMBER" });
  });
});
