import {
  canTransitionDocument,
  USER_SETTABLE_DOCUMENT_STATUS_VALUES,
  type UserSettableDocumentStatus,
} from "@/lib/validators/documents";
import type { DocumentStatus } from "@/lib/validators/enums";

/**
 * Statuses a person may move a document to from `status` (PRD §8.9.4), in the table's order: the transition table of
 * `canTransitionDocument`, with `FIRMADO` only on types with signature. `VENCIDO` is never offered (daily job only).
 */
export function allowedDocumentStatuses(
  status: DocumentStatus,
  requiresSignature: boolean,
): UserSettableDocumentStatus[] {
  return USER_SETTABLE_DOCUMENT_STATUS_VALUES.filter((to) =>
    canTransitionDocument(status, to, { requiresSignature }),
  );
}
