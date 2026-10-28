import type { GeneratedAccessKeyDTO, ShareDocumentDTO } from "@/lib/validators/shares";
import type { OneTimeAccessKey } from "../types";

/** The keys a create or update returned, labelled with their document titles, for the one-time dialog. */
export function oneTimeKeysOf(
  generated: readonly GeneratedAccessKeyDTO[],
  documents: readonly ShareDocumentDTO[],
): OneTimeAccessKey[] {
  return generated.map((key) => ({
    documentId: key.documentId,
    documentTitle:
      documents.find((doc) => doc.document.id === key.documentId)?.document.label ?? key.documentId,
    accessKey: key.accessKey,
  }));
}
