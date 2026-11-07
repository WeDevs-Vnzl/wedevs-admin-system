import type { components } from "../schema";

// Generated portal DTOs re-exported for code outside `src/lib/api/**` (C8); the portal feature picks from these.

/** `GET /api/v1/portal/{token}`. */
export type PortalShareDto = components["schemas"]["PortalShareDto"];
/** One document row of the portal page. */
export type PortalDocumentDto = PortalShareDto["documents"][number];
/** `GET /api/v1/portal/{token}/documents/{documentId}`. */
export type PortalDocumentViewDto = components["schemas"]["PortalDocumentViewDto"];
