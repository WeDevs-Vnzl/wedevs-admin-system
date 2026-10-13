// MOCK — shares fixtures of Hito 1 (data-rules.md §2, §3a Δ2). Typed empty stubs: the module package that
// builds the shares and portal UI fills them (including one link with a key-protected document, whose mock
// key is documented in the fixture as MOCK) and owns this file from then on.
import type { ShareAccessLogRowDTO, ShareLinkDetailDTO } from "@/lib/validators/shares";

/**
 * Δ2 `ShareLinkDocument` key columns, kept apart from the link DTO because no read DTO may carry a key or a
 * hash (C22). `accessKeyHash` is the `scrypt$N$r$p$<salt>$<hash>` string; `null` = no key required.
 */
export interface ShareDocumentKeyRow {
  shareLinkId: string;
  documentId: string;
  accessKeyHash: string | null;
  accessKeyUpdatedAt: string | null;
}

export const shareLinkFixtures: ShareLinkDetailDTO[] = [];
export const shareDocumentKeyFixtures: ShareDocumentKeyRow[] = [];
export const shareAccessLogFixtures: ShareAccessLogRowDTO[] = [];
