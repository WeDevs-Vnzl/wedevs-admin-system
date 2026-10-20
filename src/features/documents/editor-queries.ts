import "server-only";
import type { DocumentDetailDTO } from "@/lib/validators/documents";
import { idSchema } from "@/lib/validators/common";
import { ServiceError } from "@/server/context";
import {
  editorAvailability,
  initialEditorContent,
  type EditorAvailability,
} from "./components/document-editor-state";
import { getDocument, getDocumentPermissions } from "./queries";

export interface DocumentEditorData {
  document: DocumentDetailDTO;
  availability: EditorAvailability;
  /** The text the editor opens with (draft, else current version, else empty). */
  content: string;
}

/**
 * What `/documents/[id]/editor` renders. `null` — the page answers not-found — when the role cannot write
 * documents (Viewer), the id is malformed or unknown, or the document is archived (read-only).
 */
export async function getDocumentEditor(id: string): Promise<DocumentEditorData | null> {
  const { canUpdate } = await getDocumentPermissions();
  if (!canUpdate || !idSchema.safeParse(id).success) return null;
  try {
    const document = await getDocument(id);
    if (document.archivedAt !== null) return null;
    return {
      document,
      availability: editorAvailability(document),
      content: initialEditorContent(document),
    };
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}
