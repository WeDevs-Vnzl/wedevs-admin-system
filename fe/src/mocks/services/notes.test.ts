// MOCK — tests for the note services.
import { describe, expect, it } from "vitest";
import { noteDisplayTitle } from "@/lib/rich-text";
import { noteFilterSchema, type NotesService, type RichTextDoc } from "@/lib/validators/notes";
import type { MockServiceContext } from "../ctx";
import * as notesService from "./notes";
import { VALIDATION_MESSAGES } from "@/lib/validators/common";
import { resolveEntityRef } from "../entity-refs";
import { makeTestContext } from "../test-helpers";
import {
  archiveNote,
  attachFile,
  createNote,
  getNote,
  linkNote,
  listNotes,
  pinNote,
  unlinkNote,
  updateNote,
} from "./notes";

const doc = (text: string): RichTextDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const filter = (input: Record<string, unknown> = {}) =>
  noteFilterSchema.parse({ pageSize: 100, ...input });
const KAIROS = { entityType: "CLIENT", entityId: "cli_kairos" } as const;
const KAIROS_WEB = { entityType: "PROJECT", entityId: "pry_kairos_web" } as const;

describe("createNote", () => {
  it("sets the author from ctx.user, resolves the links and logs CREATE + LINK", async () => {
    const { ctx, db } = makeTestContext("MEMBER", { id: "usr_diego_paredes" });
    const before = db.activity.length;
    const note = await createNote(ctx, {
      title: undefined,
      content: doc("uno dos tres cuatro cinco seis siete"),
      links: [KAIROS, KAIROS_WEB],
      tagIds: [],
      pinned: false,
      attachmentFileIds: ["fil_logo_kairos"],
    });
    expect(note.author.id).toBe("usr_diego_paredes");
    expect(note.links.map((link) => link.id)).toEqual(["cli_kairos", "pry_kairos_web"]);
    expect(note.attachments.map((file) => file.id)).toEqual(["fil_logo_kairos"]);
    expect(note.contentText).toBe("uno dos tres cuatro cinco seis siete");
    expect(note.createdAt).toBe(ctx.now.toISOString());

    const entries = db.activity.slice(before);
    expect(entries.map((entry) => entry.action)).toEqual(["CREATE", "LINK", "LINK"]);
    expect(entries[0]).toMatchObject({
      entityType: "NOTE",
      entityId: note.id,
      actorId: "usr_diego_paredes",
      entityLabel: "uno dos tres cuatro cinco seis",
    });
    // The card title and the EntityRef label agree.
    expect(resolveEntityRef(db, "NOTE", note.id)?.label).toBe(noteDisplayTitle(null, note.content));
  });

  it("refuses an unknown link target with NOT_FOUND and creates nothing", async () => {
    const { ctx, db } = makeTestContext();
    const count = db.notes.length;
    await expect(
      createNote(ctx, {
        title: "x",
        content: doc("x"),
        links: [{ entityType: "CLIENT", entityId: "cli_missing" }],
        tagIds: [],
        pinned: false,
        attachmentFileIds: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.notes).toHaveLength(count);
  });

  it("accepts READY files only", async () => {
    const { ctx, db } = makeTestContext();
    db.files.push({
      id: "fil_pending",
      originalName: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      status: "PENDING",
      uploadedById: ctx.user.id,
      createdAt: ctx.now.toISOString(),
    });
    const base = {
      title: "x",
      content: doc("x"),
      links: [KAIROS],
      tagIds: [],
      pinned: false,
    };
    await expect(
      createNote(ctx, { ...base, attachmentFileIds: ["fil_pending"] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createNote(ctx, { ...base, attachmentFileIds: ["fil_missing"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateNote", () => {
  it("keeps the author, records the content diff as 'changed' and the title diff", async () => {
    const { ctx, db } = makeTestContext("ADMIN", { id: "usr_other" });
    const before = db.activity.length;
    const note = await updateNote(ctx, {
      id: "note_kairos_alcance",
      title: "Nuevo título",
      content: doc("contenido nuevo"),
      tagIds: ["tag_prioritario"],
    });
    expect(note.author.id).toBe("usr_andres_molina");
    expect(note.title).toBe("Nuevo título");
    expect(note.updatedAt).toBe(ctx.now.toISOString());
    const entry = db.activity.slice(before).at(-1)!;
    expect(entry.action).toBe("UPDATE");
    expect(entry.changes?.content).toBe("changed");
    expect(entry.changes?.title).toEqual(["Alcance acordado con Kairos", "Nuevo título"]);
  });

  it("logs nothing when nothing changed", async () => {
    const { ctx, db } = makeTestContext();
    const current = await getNote(ctx, { id: "note_kairos_alcance" });
    const before = db.activity.length;
    await updateNote(ctx, {
      id: current.id,
      title: current.title ?? undefined,
      content: current.content,
      tagIds: current.tags.map((tag) => tag.id),
    });
    expect(db.activity).toHaveLength(before);
  });
});

describe("pin, link, unlink, attach", () => {
  it("pins and unpins", async () => {
    const { ctx } = makeTestContext();
    expect((await pinNote(ctx, { id: "note_kairos_reunion", pinned: true })).pinned).toBe(true);
    expect((await pinNote(ctx, { id: "note_kairos_reunion", pinned: false })).pinned).toBe(false);
  });

  it("links a new target, refuses a repeat (CONFLICT with the entity) and an unknown one", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.activity.length;
    const linked = await linkNote(ctx, { noteId: "note_kairos_reunion", target: KAIROS });
    expect(linked.links.map((link) => link.id)).toContain("cli_kairos");
    expect(db.activity.at(-1)).toMatchObject({ action: "LINK", entityType: "NOTE" });
    expect(db.activity.length).toBe(before + 1);
    await expect(
      linkNote(ctx, { noteId: "note_kairos_reunion", target: KAIROS }),
    ).rejects.toMatchObject({ code: "CONFLICT", entity: { id: "cli_kairos" } });
    await expect(
      linkNote(ctx, {
        noteId: "note_kairos_reunion",
        target: { entityType: "CLIENT", entityId: "cli_missing" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unlinks one of several links and refuses to remove the last one", async () => {
    const { ctx, db } = makeTestContext();
    const note = await unlinkNote(ctx, { noteId: "note_kairos_alcance", target: KAIROS });
    expect(note.links.map((link) => link.id)).toEqual(["pry_kairos_web"]);
    expect(db.activity.at(-1)?.action).toBe("UNLINK");
    await expect(
      unlinkNote(ctx, { noteId: "note_kairos_alcance", target: KAIROS_WEB }),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    await expect(
      unlinkNote(ctx, { noteId: "note_kairos_alcance", target: KAIROS }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("attaches a READY file once and logs UPLOAD", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.activity.length;
    const note = await attachFile(ctx, {
      noteId: "note_kairos_reunion",
      fileId: "fil_brief_marca",
    });
    expect(note.attachments.map((file) => file.id)).toEqual(["fil_brief_marca"]);
    await attachFile(ctx, { noteId: "note_kairos_reunion", fileId: "fil_brief_marca" });
    expect(db.activity.slice(before).map((entry) => entry.action)).toEqual(["UPLOAD"]);
  });
});

describe("archiveNote", () => {
  it("archives (DELETE) and hides the note from default lists", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.activity.length;
    const result = await archiveNote(ctx, { id: "note_kairos_reunion" });
    expect(result).toEqual({ id: "note_kairos_reunion", archivedAt: ctx.now.toISOString() });
    expect(db.notes.find((n) => n.id === "note_kairos_reunion")?.deletedById).toBe(ctx.user.id);
    expect(db.activity.slice(before).map((entry) => entry.action)).toEqual(["DELETE"]);
    const page = await listNotes(ctx, filter());
    expect(page.items.some((row) => row.id === "note_kairos_reunion")).toBe(false);
    await expect(pinNote(ctx, { id: "note_kairos_reunion", pinned: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await getNote(ctx, { id: "note_kairos_reunion" })).archivedAt).not.toBeNull();
  });

  it("lets a Member archive only their own note", async () => {
    const { ctx } = makeTestContext("MEMBER", { id: "usr_diego_paredes" });
    await expect(archiveNote(ctx, { id: "note_kairos_reunion" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(archiveNote(ctx, { id: "note_solaris_minuta" })).resolves.toMatchObject({
      id: "note_solaris_minuta",
    });
  });
});

describe("listNotes", () => {
  it("feeds one record with pinned notes first, then newest", async () => {
    const { ctx } = makeTestContext();
    const page = await listNotes(
      ctx,
      filter({ entityType: "PROJECT", entityId: "pry_solaris_portal" }),
    );
    expect(page.items.map((row) => row.id)).toEqual([
      "note_solaris_retraso",
      "note_solaris_minuta",
    ]);
    const kairos = await listNotes(ctx, filter({ entityType: "CLIENT", entityId: "cli_kairos" }));
    const flags = kairos.items.map((row) => row.pinned);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    const dates = kairos.items.filter((row) => !row.pinned).map((row) => row.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(kairos.items[0]?.id).toBe("note_kairos_alcance");
  });

  it("table filters: author, tag, linked type, pinned, dates, text", async () => {
    const { ctx } = makeTestContext();
    const byAuthor = await listNotes(ctx, filter({ authorId: "usr_diego_paredes" }));
    expect(byAuthor.items.every((row) => row.author.id === "usr_diego_paredes")).toBe(true);
    expect(byAuthor.total).toBeGreaterThan(0);

    const byTag = await listNotes(ctx, filter({ tagId: "tag_urgente" }));
    expect(byTag.items.map((row) => row.id).sort()).toEqual(
      ["note_kairos_app_riesgo", "note_solaris_retraso"].sort(),
    );

    const docs = await listNotes(ctx, filter({ linkedEntityType: "DOCUMENT" }));
    expect(docs.items.every((row) => row.links.some((link) => link.type === "DOCUMENT"))).toBe(
      true,
    );

    const pinned = await listNotes(ctx, filter({ pinned: true }));
    expect(pinned.items.every((row) => row.pinned)).toBe(true);

    const ranged = await listNotes(
      ctx,
      filter({ createdFrom: "2026-09-27", createdTo: "2026-09-30" }),
    );
    expect(ranged.total).toBeGreaterThan(0);
    expect(
      ranged.items.every((row) => row.createdAt >= "2026-09-27" && row.createdAt < "2026-10-01"),
    ).toBe(true);
    const all = await listNotes(ctx, filter());
    expect(ranged.total).toBe(
      all.items.filter((row) => row.createdAt >= "2026-09-27" && row.createdAt < "2026-10-01")
        .length,
    );

    const text = await listNotes(ctx, filter({ q: "integracion de pagos" }));
    expect(text.items.map((row) => row.id)).toContain("note_kairos_app_riesgo");
  });

  it("sorts the table by title and defaults to newest first", async () => {
    const { ctx } = makeTestContext();
    const newest = await listNotes(ctx, filter());
    const created = newest.items.map((row) => row.createdAt);
    expect(created).toEqual([...created].sort().reverse());
    const byTitle = await listNotes(ctx, filter({ sort: "title:asc" }));
    expect(byTitle.items).toHaveLength(newest.items.length);
  });

  it("hides archived notes unless an Owner or Admin asks", async () => {
    const owner = makeTestContext("OWNER");
    owner.db.notes.find((n) => n.id === "note_kairos_reunion")!.archivedAt =
      "2026-10-01T00:00:00.000Z";
    const withArchived = await listNotes(owner.ctx, filter({ includeArchived: true }));
    expect(withArchived.items.some((row) => row.id === "note_kairos_reunion")).toBe(true);

    const member = makeTestContext("MEMBER");
    member.db.notes.find((n) => n.id === "note_kairos_reunion")!.archivedAt =
      "2026-10-01T00:00:00.000Z";
    const ignored = await listNotes(member.ctx, filter({ includeArchived: true }));
    expect(ignored.items.some((row) => row.id === "note_kairos_reunion")).toBe(false);
  });

  it("assembles list rows: excerpt, author, tags, links, attachment count", async () => {
    const { ctx } = makeTestContext();
    const row = (
      await listNotes(ctx, filter({ entityType: "CLIENT", entityId: "cli_kairos" }))
    ).items.find((item) => item.id === "note_kairos_logo")!;
    expect(row.attachmentCount).toBe(2);
    expect(row.author.name).toBeTruthy();
    expect(row.links.map((link) => link.type)).toEqual(["CLIENT"]);
    expect(row.excerpt.length).toBeLessThanOrEqual(241);
  });
});

describe("getNote", () => {
  it("returns the detail and NOT_FOUND for an unknown id", async () => {
    const { ctx } = makeTestContext();
    const note = await getNote(ctx, { id: "note_kairos_alcance" });
    expect(note.tags.map((tag) => tag.id)).toEqual(["tag_prioritario"]);
    expect(note.links).toHaveLength(2);
    await expect(getNote(ctx, { id: "note_nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ───────────────────────────── Wave 2 fix round (package 2.9) ─────────────────────────────

const imageDoc = (fileId: string): RichTextDoc => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Con imagen" }] },
    { type: "image", attrs: { fileId, src: `/api/files/${fileId}/download` } },
  ],
});
const newNote = (over: Record<string, unknown> = {}) => ({
  title: "Nota",
  content: doc("texto"),
  links: [KAIROS],
  tagIds: [],
  pinned: false,
  attachmentFileIds: [],
  ...over,
});

describe("type contract (F12)", () => {
  it("satisfies NotesService over the mock context", () => {
    const service = notesService satisfies NotesService<MockServiceContext>;
    expect(typeof service.createNote).toBe("function");
  });
});

describe("getNote on an archived note (F6, C19)", () => {
  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MEMBER", false],
    ["VIEWER", false],
  ] as const)("%s reads it: %s", async (role, allowed) => {
    const { ctx, db } = makeTestContext(role);
    const note = db.notes[0]!;
    note.archivedAt = "2026-10-01T00:00:00.000Z";
    const read = getNote(ctx, { id: note.id });
    if (allowed) await expect(read).resolves.toMatchObject({ id: note.id });
    else await expect(read).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("attachment errors (F9)", () => {
  it("reports a not-ready attachment with the shared invalidOption key", async () => {
    const { ctx, db } = makeTestContext();
    db.files.push({ ...db.files[0]!, id: "fil_pending", status: "PENDING" });
    await expect(
      createNote(ctx, newNote({ attachmentFileIds: ["fil_pending"] })),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { attachmentFileIds: [VALIDATION_MESSAGES.invalidOption] },
    });
  });
});

describe("archived targets (CR-B1, C14/C19)", () => {
  const archive = (db: ReturnType<typeof makeTestContext>["db"], type: string, id: string) => {
    const collection = {
      CLIENT: db.clients,
      CONTACT: db.contacts,
      PROJECT: db.projects,
      DOCUMENT: db.documents,
    }[type as "CLIENT"] as { id: string; archivedAt: string | null }[];
    collection.find((row) => row.id === id)!.archivedAt = "2026-10-01T00:00:00.000Z";
  };
  const cases = (db: ReturnType<typeof makeTestContext>["db"]) =>
    [
      ["CLIENT", "cli_kairos"],
      ["CONTACT", db.contacts[0]!.id],
      ["PROJECT", "pry_kairos_web"],
      ["DOCUMENT", db.documents[0]!.id],
    ] as const;

  it.each(["CLIENT", "CONTACT", "PROJECT", "DOCUMENT"] as const)(
    "createNote and linkNote refuse an archived %s with NOT_FOUND",
    async (type) => {
      const { ctx, db } = makeTestContext();
      const [, id] = cases(db).find(([t]) => t === type)!;
      const own = await createNote(ctx, newNote());
      archive(db, type, id);
      const target = { entityType: type, entityId: id } as const;
      const count = db.notes.length;
      await expect(createNote(ctx, newNote({ links: [target] }))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(db.notes).toHaveLength(count);
      await expect(linkNote(ctx, { noteId: own.id, target })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    },
  );
});

describe("rich-text images (CR-B2, C14/C23)", () => {
  it("adds READY images to the attachments and refuses unknown or not-ready ones", async () => {
    const { ctx, db } = makeTestContext();
    const ready = db.files.find((file) => file.status === "READY")!;
    const created = await createNote(ctx, newNote({ content: imageDoc(ready.id) }));
    expect(created.attachments.map((file) => file.id)).toEqual([ready.id]);

    await expect(
      createNote(ctx, newNote({ content: imageDoc("fil_missing") })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.files.push({ ...ready, id: "fil_pending", status: "PENDING" });
    await expect(
      createNote(ctx, newNote({ content: imageDoc("fil_pending") })),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const plain = await createNote(ctx, newNote());
    const update = { id: plain.id, title: "Nota", tagIds: [] };
    await expect(
      updateNote(ctx, { ...update, content: imageDoc("fil_pending") }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      updateNote(ctx, { ...update, content: imageDoc("fil_missing") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const updated = await updateNote(ctx, { ...update, content: imageDoc(ready.id) });
    expect(updated.attachments.map((file) => file.id)).toEqual([ready.id]);
  });
});

describe("tag diff (CR-B4, C1)", () => {
  it("logs sorted tag names joined with ', ', never ids", async () => {
    const { ctx, db } = makeTestContext();
    const note = await createNote(ctx, newNote());
    const tags = db.tags.slice(0, 2);
    await updateNote(ctx, {
      id: note.id,
      title: "Nota",
      content: doc("texto"),
      tagIds: tags.map((t) => t.id).reverse(),
    });
    const changes = db.activity.at(-1)!.changes as Record<string, [string, string]>;
    const expected = tags
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
      .join(", ");
    expect(changes.tagIds).toEqual(["", expected]);
    expect(JSON.stringify(changes)).not.toMatch(/tag_/);
  });
});
