import { describe, expect, it } from "vitest";
import type { NoteDetailDto, NoteListResponseDto } from "@/lib/api/types/notes";
import { toNoteDetail, toNotePage } from "./mappers";

const wire: NoteDetailDto = {
  id: "note_1",
  title: null,
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
  },
  contentText: "Hola",
  author: { id: "usr_1", name: "Ana", imageUrl: null },
  pinned: false,
  tags: [{ id: "tag_1", name: "Urgente", color: "#ff0000" }],
  links: [{ type: "CLIENT", id: "cli_1", label: "Kairos", code: null }],
  attachments: [
    {
      id: "fil_1",
      originalName: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      status: "READY",
      uploadedById: "usr_1",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

describe("toNoteDetail", () => {
  it("parses links through entityRefSchema (wire null code becomes undefined)", () => {
    const note = toNoteDetail(wire);
    expect(note.links[0]).toEqual({ type: "CLIENT", id: "cli_1", label: "Kairos" });
    expect(note.links[0]).not.toHaveProperty("code", null);
    expect(note.attachments[0]?.status).toBe("READY");
  });

  it("replaces a document outside the editor allowlist with an empty one (C4)", () => {
    const hostile = { ...wire, content: { type: "doc", content: [{ type: "script" }] } };
    expect(toNoteDetail(hostile).content).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("toNotePage", () => {
  it("maps every row and keeps the pagination", () => {
    const page: NoteListResponseDto = {
      items: [
        {
          id: "note_1",
          title: "T",
          excerpt: "Hola",
          author: wire.author,
          pinned: true,
          tags: [],
          links: wire.links,
          attachmentCount: 2,
          createdAt: wire.createdAt,
          updatedAt: wire.updatedAt,
          archivedAt: null,
        },
      ],
      page: 1,
      pageSize: 25,
      pageCount: 1,
      total: 1,
    };
    const out = toNotePage(page);
    expect(out).toMatchObject({ total: 1, page: 1, pageSize: 25, pageCount: 1 });
    expect(out.items[0]?.links[0]).toEqual({ type: "CLIENT", id: "cli_1", label: "Kairos" });
    expect(out.items[0]?.attachmentCount).toBe(2);
  });
});
