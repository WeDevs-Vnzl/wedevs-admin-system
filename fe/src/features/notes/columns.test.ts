import { describe, expect, it } from "vitest";
import type { NoteListRowDTO } from "@/lib/validators/notes";
import { NOTE_COLUMN_IDS, NOTE_EXPORT_COLUMNS, noteRowTitle } from "./columns";

const row: NoteListRowDTO = {
  id: "not_1",
  title: null,
  excerpt: "uno dos tres cuatro cinco seis siete ocho",
  author: { id: "usr_a", name: "Ana", imageUrl: null },
  pinned: true,
  tags: [{ id: "tag_1", name: "Urgente", color: "#ff0000" }],
  links: [
    { id: "cli_1", label: "Kairos", type: "CLIENT" },
    { id: "pry_1", label: "Web", type: "PROJECT" },
  ],
  attachmentCount: 2,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  archivedAt: null,
};

describe("notes columns", () => {
  it("has one export spec per column id with a columns.<id> label key", () => {
    expect(Object.keys(NOTE_EXPORT_COLUMNS).sort()).toEqual([...NOTE_COLUMN_IDS].sort());
    for (const id of NOTE_COLUMN_IDS)
      expect(NOTE_EXPORT_COLUMNS[id].labelKey).toBe(`columns.${id}`);
  });

  it("derives cells: title from the first six words, joined links and tags, flags", () => {
    expect(noteRowTitle(row)).toBe("uno dos tres cuatro cinco seis");
    expect(noteRowTitle({ ...row, title: "Mi nota" })).toBe("Mi nota");
    expect(NOTE_EXPORT_COLUMNS.links.value(row)).toBe("Kairos; Web");
    expect(NOTE_EXPORT_COLUMNS.tags.value(row)).toBe("Urgente");
    expect(NOTE_EXPORT_COLUMNS.pinned.value(row)).toBe("1");
    expect(NOTE_EXPORT_COLUMNS.attachments.value(row)).toBe(2);
    expect(NOTE_EXPORT_COLUMNS.author.value(row)).toBe("Ana");
  });
});
