// MOCK — tests for the note services.
import { describe, expect, it } from "vitest";
import { noteDisplayTitle } from "@/lib/rich-text";
import { noteFilterSchema, type RichTextDoc } from "@/lib/validators/notes";
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
