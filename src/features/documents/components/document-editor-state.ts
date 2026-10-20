import type { DocumentDetailDTO } from "@/lib/validators/documents";

/**
 * What the markdown editor may do with a document:
 * - `editable` — a markdown document (its current version is markdown, or it has no version yet and its type
 *   defaults to markdown);
 * - `signed` — a `FIRMADO` markdown document: read-only, no new version (PRD §8.9.3 "Bloqueo por firma");
 * - `notMarkdown` — a file or link document, whose content changes from the detail instead.
 */
export type EditorAvailability = "editable" | "signed" | "notMarkdown";

type EditorDocument = Pick<
  DocumentDetailDTO,
  "status" | "type" | "currentVersion" | "draftContent"
>;

export function editorAvailability(document: EditorDocument): EditorAvailability {
  const format = document.currentVersion?.format ?? document.type.defaultFormat;
  if (format !== "MARKDOWN") return "notMarkdown";
  return document.status === "FIRMADO" ? "signed" : "editable";
}

/** The text the editor opens with: the saved draft, else the current version, else empty. */
export function initialEditorContent(document: EditorDocument): string {
  return document.draftContent ?? document.currentVersion?.content ?? "";
}
