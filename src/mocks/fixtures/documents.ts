// MOCK — documents fixtures of Hito 1 (data-rules.md §2). Typed empty stubs: the module package that builds
// the documents UI fills them (all three formats, with versions) and owns this file from then on.
import type { FileDTO } from "@/lib/validators/files";
import type {
  DocumentDetailDTO,
  DocumentLinkDTO,
  DocumentVersionDetailDTO,
} from "@/lib/validators/documents";

export const documentFixtures: DocumentDetailDTO[] = [];
export const documentVersionFixtures: DocumentVersionDetailDTO[] = [];
export const documentLinkFixtures: DocumentLinkDTO[] = [];
/** Files behind documents, invoices and receipts. Runtime uploads are appended by the files service. */
export const fileFixtures: FileDTO[] = [];
