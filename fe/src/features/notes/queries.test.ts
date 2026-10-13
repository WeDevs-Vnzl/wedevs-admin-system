import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { makeSessionUser } from "@/mocks/test-helpers";
import { getNote, getNotesViewer, listNotes } from "./queries";

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
  it("lists the feed of a record, pinned first", async () => {
    const page = await listNotes({ entityType: "PROJECT", entityId: "pry_solaris_portal" });
    expect(page.items.map((row) => row.id)).toEqual([
      "note_solaris_retraso",
      "note_solaris_minuta",
    ]);
  });

  it("parses the filter: an entity type without id is refused", async () => {
    await expect(listNotes({ entityType: "PROJECT" })).rejects.toThrow();
  });

  it("gets a note and throws NOT_FOUND for an unknown id", async () => {
    expect((await getNote({ id: "note_kairos_alcance" })).title).toBe(
      "Alcance acordado con Kairos",
    );
    await expect(getNote({ id: "note_nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the viewer id and role", async () => {
    expect(await getNotesViewer()).toEqual({ id: "usr_diego_paredes", role: "MEMBER" });
  });
});
