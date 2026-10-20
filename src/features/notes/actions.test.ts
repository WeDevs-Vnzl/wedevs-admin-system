import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);

import type { RichTextDoc } from "@/lib/validators/notes";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  archiveNoteAction,
  attachFileAction,
  createNoteAction,
  exportNotesCsvAction,
  getNoteAction,
  linkNoteAction,
  listNotesAction,
  pinNoteAction,
  unlinkNoteAction,
  updateNoteAction,
} from "./actions";

const doc: RichTextDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Una nota de prueba" }] }],
};
const links = [{ entityType: "CLIENT", entityId: "cli_kairos" }] as const;
const asRole = (role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER", id = "usr_test") =>
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id }));

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockClear();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("create / update / pin / link / unlink / attach", () => {
  it("lets Owner, Admin and Member create; refuses a Viewer; revalidates the feed pages", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      asRole(role);
      expect(
        await createNoteAction({ content: doc, links: [...links], title: undefined }),
      ).toMatchObject({ ok: true, data: { author: { id: "usr_test" } } });
    }
    expect(cache.revalidatePath).toHaveBeenCalledWith("/notes");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients/cli_kairos");

    asRole("VIEWER");
    const count = getMockStore().notes.length;
    expect(await createNoteAction({ content: doc, links: [...links] })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(getMockStore().notes).toHaveLength(count);
  });

  it("validates the input: blank content, no links, a javascript: link in the document", async () => {
    asRole("OWNER");
    const blank = { type: "doc", content: [{ type: "paragraph" }] };
    expect(
      await createNoteAction({ content: blank as RichTextDoc, links: [...links] }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await createNoteAction({ content: doc, links: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    const hostile = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    } as RichTextDoc;
    expect(await createNoteAction({ content: hostile, links: [...links] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("maps an unknown link target to NOT_FOUND", async () => {
    asRole("OWNER");
    expect(
      await createNoteAction({
        content: doc,
        links: [{ entityType: "CLIENT", entityId: "cli_nope" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("update, pin, link, unlink and attach need the update grant", async () => {
    asRole("MEMBER");
    expect(
      await updateNoteAction({ id: "note_kairos_alcance", content: doc, title: "Nuevo" }),
    ).toMatchObject({ ok: true, data: { title: "Nuevo" } });
    expect(await pinNoteAction({ id: "note_kairos_reunion", pinned: true })).toMatchObject({
      ok: true,
    });
    expect(
      await linkNoteAction({
        noteId: "note_kairos_reunion",
        target: { entityType: "CLIENT", entityId: "cli_kairos" },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await unlinkNoteAction({
        noteId: "note_kairos_reunion",
        target: { entityType: "CLIENT", entityId: "cli_kairos" },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await attachFileAction({ noteId: "note_kairos_reunion", fileId: "fil_brief_marca" }),
    ).toMatchObject({ ok: true });

    asRole("VIEWER");
    for (const result of [
      await updateNoteAction({ id: "note_kairos_alcance", content: doc }),
      await pinNoteAction({ id: "note_kairos_alcance", pinned: false }),
      await linkNoteAction({ noteId: "note_kairos_alcance", target: links[0] }),
      await unlinkNoteAction({ noteId: "note_kairos_alcance", target: links[0] }),
      await attachFileAction({ noteId: "note_kairos_alcance", fileId: "fil_brief_marca" }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
  });

  it("refuses to remove the last link (INTEGRITY_LOCK)", async () => {
    asRole("OWNER");
    expect(
      await unlinkNoteAction({
        noteId: "note_kairos_reunion",
        target: { entityType: "PROJECT", entityId: "pry_kairos_web" },
      }),
    ).toMatchObject({ ok: false, error: { code: "INTEGRITY_LOCK" } });
  });
});

describe("archiveNoteAction (own-records grant, PRD §4.3)", () => {
  it("a Member archives their own note", async () => {
    asRole("MEMBER", "usr_diego_paredes");
    expect(await archiveNoteAction({ id: "note_solaris_minuta" })).toMatchObject({
      ok: true,
      data: { id: "note_solaris_minuta" },
    });
    expect(
      getMockStore().notes.find((n) => n.id === "note_solaris_minuta")?.archivedAt,
    ).not.toBeNull();
  });

  it("a Member cannot archive another user's note, and nothing changes", async () => {
    asRole("MEMBER", "usr_diego_paredes");
    expect(await archiveNoteAction({ id: "note_kairos_reunion" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(getMockStore().notes.find((n) => n.id === "note_kairos_reunion")?.archivedAt).toBeNull();
  });

  it("Owner and Admin archive any note; a Viewer none; an unknown id is NOT_FOUND", async () => {
    asRole("ADMIN", "usr_admin");
    expect(await archiveNoteAction({ id: "note_kairos_reunion" })).toMatchObject({ ok: true });
    asRole("VIEWER", "usr_andres_molina");
    expect(await archiveNoteAction({ id: "note_kairos_alcance" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    asRole("OWNER");
    expect(await archiveNoteAction({ id: "note_nope" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("read and export actions", () => {
  it("lists a feed with pinned notes first (read grant: every role) and gets one note", async () => {
    asRole("VIEWER");
    const feed = await listNotesAction({
      entityType: "PROJECT",
      entityId: "pry_solaris_portal",
      pageSize: 25,
    });
    expect(feed.ok && feed.data.items.map((row) => row.id)).toEqual([
      "note_solaris_retraso",
      "note_solaris_minuta",
    ]);
    expect(await getNoteAction({ id: "note_kairos_alcance" })).toMatchObject({
      ok: true,
      data: { id: "note_kairos_alcance" },
    });
    expect(await listNotesAction({ entityType: "PROJECT" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("exports the notes table as CSV with translated headers and the visible columns only", async () => {
    asRole("OWNER");
    const result = await exportNotesCsvAction({
      entity: "NOTE",
      query: { filters: { tagId: "tag_urgente" } },
      columns: ["title", "author", "pinned"],
    });
    expect(intl.getTranslations).toHaveBeenCalledWith("notes");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rowCount).toBe(2);
    expect(result.data.content).toContain(
      "notes:columns.title,notes:columns.author,notes:columns.pinned",
    );
    expect(result.data.content).toContain("Retraso del portal Solaris");

    expect(
      await exportNotesCsvAction({ entity: "NOTE", query: {}, columns: ["nope"] }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    asRole("VIEWER");
    expect(
      await exportNotesCsvAction({ entity: "NOTE", query: {}, columns: ["title"] }),
    ).toMatchObject({
      ok: true,
    });
  });
});
