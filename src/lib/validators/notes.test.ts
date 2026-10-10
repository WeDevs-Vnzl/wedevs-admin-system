import type { NotesService } from "./notes";
import { describe, expect, it } from "vitest";
import {
  RICH_TEXT_MAX_BYTES,
  archiveNoteInputSchema,
  attachFileInputSchema,
  createNoteInputSchema,
  linkNoteInputSchema,
  noteDetailSchema,
  noteFilterSchema,
  noteListRowSchema,
  pinNoteInputSchema,
  richTextDocSchema,
  richTextHasContent,
  updateNoteInputSchema,
} from "./notes";

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});
const valid = {
  content: doc("Reunión de kickoff"),
  links: [{ entityType: "PROJECT", entityId: "pry_1" }],
};

describe("rich text (Tiptap JSON allowlist, C4)", () => {
  it("accepts headings, lists, task lists, code, quotes, tables, images and marks", () => {
    const rich = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Título" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "uno" }] }],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
          ],
        },
        { type: "codeBlock", content: [{ type: "text", text: "const a = 1" }] },
        { type: "blockquote", content: [{ type: "paragraph" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "enlace",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
            { type: "text", text: "negrita", marks: [{ type: "bold" }] },
          ],
        },
        { type: "image", attrs: { src: "file_1" } },
      ],
    };
    expect(richTextDocSchema.safeParse(rich).success).toBe(true);
  });

  it("rejects node types outside the allowlist (script, iframe…)", () => {
    for (const type of ["script", "iframe", "html", "style"]) {
      expect(richTextDocSchema.safeParse({ type: "doc", content: [{ type }] }).success, type).toBe(
        false,
      );
    }
    expect(richTextDocSchema.safeParse({ type: "paragraph" }).success).toBe(false);
  });

  it("rejects mark types outside the allowlist and unsafe link hrefs", () => {
    const withMark = (mark: unknown) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [mark] }] }],
    });
    expect(richTextDocSchema.safeParse(withMark({ type: "highlightHtml" })).success).toBe(false);
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.com", undefined]) {
      expect(
        richTextDocSchema.safeParse(withMark({ type: "link", attrs: { href } })).success,
        String(href),
      ).toBe(false);
    }
    expect(
      richTextDocSchema.safeParse(
        withMark({ type: "link", attrs: { href: "mailto:ana@example.com" } }),
      ).success,
    ).toBe(true);
  });

  it("caps the serialized size", () => {
    expect(richTextDocSchema.safeParse(doc("x".repeat(RICH_TEXT_MAX_BYTES))).success).toBe(false);
  });

  it("richTextHasContent tells blank documents from real ones", () => {
    expect(richTextHasContent({ type: "doc", content: [{ type: "paragraph" }] } as never)).toBe(
      false,
    );
    expect(richTextHasContent(doc("   ") as never)).toBe(false);
    expect(richTextHasContent(doc("hola") as never)).toBe(true);
    expect(richTextHasContent({ type: "doc", content: [{ type: "image" }] } as never)).toBe(true);
  });
});

describe("createNote", () => {
  it("accepts content + one link and applies defaults", () => {
    const parsed = createNoteInputSchema.parse(valid);
    expect(parsed.pinned).toBe(false);
    expect(parsed.tagIds).toEqual([]);
    expect(parsed.attachmentFileIds).toEqual([]);
    expect(parsed.title).toBeUndefined();
  });

  it("title is optional", () => {
    expect(createNoteInputSchema.parse({ ...valid, title: "  " }).title).toBeUndefined();
    expect(createNoteInputSchema.parse({ ...valid, title: "Kickoff" }).title).toBe("Kickoff");
    expect(createNoteInputSchema.safeParse({ ...valid, title: "x".repeat(201) }).success).toBe(
      false,
    );
  });

  it("rejects blank content, missing links, repeated links and unlinkable entities", () => {
    expect(
      createNoteInputSchema.safeParse({
        ...valid,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      }).success,
    ).toBe(false);
    expect(createNoteInputSchema.safeParse({ ...valid, content: doc("  ") }).success).toBe(false);
    expect(createNoteInputSchema.safeParse({ ...valid, links: [] }).success).toBe(false);
    expect(createNoteInputSchema.safeParse({ content: valid.content }).success).toBe(false);
    expect(
      createNoteInputSchema.safeParse({ ...valid, links: [valid.links[0], valid.links[0]] })
        .success,
    ).toBe(false);
    expect(
      createNoteInputSchema.safeParse({
        ...valid,
        links: [{ entityType: "ACCOUNT", entityId: "acc_1" }],
      }).success,
    ).toBe(false);
  });

  it("links every linkable entity type of PRD §8.10", () => {
    for (const entityType of [
      "CLIENT",
      "CONTACT",
      "PROJECT",
      "DOCUMENT",
      "INVOICE",
      "PAYMENT",
      "EXPENSE",
    ]) {
      expect(
        createNoteInputSchema.safeParse({ ...valid, links: [{ entityType, entityId: "x1" }] })
          .success,
        entityType,
      ).toBe(true);
    }
  });

  it("update, pin, link, attach and archive inputs", () => {
    expect(updateNoteInputSchema.safeParse({ id: "n1", content: doc("a") }).success).toBe(true);
    expect(updateNoteInputSchema.safeParse({ content: doc("a") }).success).toBe(false);
    expect(pinNoteInputSchema.safeParse({ id: "n1", pinned: true }).success).toBe(true);
    expect(pinNoteInputSchema.safeParse({ id: "n1" }).success).toBe(false);
    expect(linkNoteInputSchema.safeParse({ noteId: "n1", target: valid.links[0] }).success).toBe(
      true,
    );
    expect(attachFileInputSchema.safeParse({ noteId: "n1", fileId: "f1" }).success).toBe(true);
    expect(archiveNoteInputSchema.safeParse({ id: "n1" }).success).toBe(true);
  });
});

describe("note filters and DTOs", () => {
  it("filters by author, tag, linked type, pinned and dates", () => {
    const parsed = noteFilterSchema.parse({
      authorId: "usr_1",
      linkedEntityType: ["CLIENT", "PROJECT"],
      pinned: "true",
      createdFrom: "2026-10-01",
      sort: "createdAt:desc",
    });
    expect(parsed.linkedEntityType).toEqual(["CLIENT", "PROJECT"]);
    expect(parsed.pinned).toBe(true);
    expect(noteFilterSchema.safeParse({ createdFrom: "10/01/2026" }).success).toBe(false);
    expect(noteFilterSchema.safeParse({ sort: "contentText:asc" }).success).toBe(false);
  });

  it("the entity feed needs both entityType and entityId", () => {
    expect(noteFilterSchema.safeParse({ entityType: "CLIENT", entityId: "cli_1" }).success).toBe(
      true,
    );
    expect(noteFilterSchema.safeParse({ entityType: "CLIENT" }).success).toBe(false);
    expect(noteFilterSchema.safeParse({ entityId: "cli_1" }).success).toBe(false);
  });

  const author = { id: "usr_1", name: "Andrés", imageUrl: null };
  const base = {
    id: "n1",
    title: null,
    author,
    pinned: false,
    tags: [],
    links: [{ id: "pry_1", code: "PRY-0001", label: "Portal", type: "PROJECT" }],
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    archivedAt: null,
  };

  it("list row and detail DTOs", () => {
    expect(
      noteListRowSchema.safeParse({ ...base, excerpt: "Reunión…", attachmentCount: 0 }).success,
    ).toBe(true);
    expect(
      noteDetailSchema.safeParse({
        ...base,
        content: doc("hola"),
        contentText: "hola",
        attachments: [],
      }).success,
    ).toBe(true);
  });
});

describe("NotesService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "createNote",
      "updateNote",
      "pinNote",
      "linkNote",
      "unlinkNote",
      "attachFile",
      "archiveNote",
    ] as const satisfies readonly (keyof NotesService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
