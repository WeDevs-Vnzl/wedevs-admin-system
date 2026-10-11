import { noteDisplayTitle } from "@/lib/rich-text";
import type { ExportColumnSpec } from "@/lib/validators/export";
import type { NoteListRowDTO } from "@/lib/validators/notes";

/**
 * Columns of the notes table (PRD §8.10), shared by the CSV export source and the W3 table. Label keys are
 * `notes.columns.<id>`; the export action resolves them under the `notes` namespace (`columns.<id>`).
 */
export const NOTE_COLUMN_IDS = [
  "title",
  "excerpt",
  "author",
  "links",
  "tags",
  "attachments",
  "pinned",
  "createdAt",
  "updatedAt",
] as const;
export type NoteColumnId = (typeof NOTE_COLUMN_IDS)[number];

/** The title the card shows: the title, or the first words of the content. */
export function noteRowTitle(row: Pick<NoteListRowDTO, "title" | "excerpt">): string {
  return noteDisplayTitle(row.title, { text: row.excerpt });
}

/** Cell of every exportable column (`ExportSource.columns`); `labelKey` is `columns.<id>`. */
export const NOTE_EXPORT_COLUMNS: Record<NoteColumnId, ExportColumnSpec<NoteListRowDTO>> = {
  title: { labelKey: "columns.title", value: noteRowTitle },
  excerpt: { labelKey: "columns.excerpt", value: (row) => row.excerpt },
  author: { labelKey: "columns.author", value: (row) => row.author.name },
  links: {
    labelKey: "columns.links",
    value: (row) => row.links.map((link) => link.label).join("; "),
  },
  tags: { labelKey: "columns.tags", value: (row) => row.tags.map((tag) => tag.name).join("; ") },
  attachments: { labelKey: "columns.attachments", value: (row) => row.attachmentCount },
  pinned: { labelKey: "columns.pinned", value: (row) => (row.pinned ? "1" : "0") },
  createdAt: { labelKey: "columns.createdAt", value: (row) => row.createdAt },
  updatedAt: { labelKey: "columns.updatedAt", value: (row) => row.updatedAt },
};
