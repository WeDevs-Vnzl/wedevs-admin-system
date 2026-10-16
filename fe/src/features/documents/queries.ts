import "server-only";
import { listDocumentCategories as listCategories } from "@/features/catalogs/queries";
import { getClient } from "@/features/clients/queries";
import { getProject } from "@/features/projects/queries";
import { idSchema, type EntityRef } from "@/lib/validators/common";
import {
  documentFilterSchema,
  documentIdInputSchema,
  getDocumentsOverviewInputSchema,
  getDocumentVersionInputSchema,
  listDocumentVersionsInputSchema,
  type DocumentDetailDTO,
  type DocumentFilterInput,
  type DocumentVersionDetailDTO,
  type DocumentVersionRowDTO,
} from "@/lib/validators/documents";
import * as documents from "@/mocks/services/documents";
import { samplePdf } from "@/mocks/sample-pdf";
import { getServiceContext, ServiceError } from "@/server/context";
import { can } from "@/server/auth/permissions";

/** Rows of the entity's Documentos tab fit one page: the tab shows every linked document, no paging. */
const ENTITY_TAB_PAGE_SIZE = 100;

export async function listDocuments(filter: DocumentFilterInput = {}) {
  return documents.listDocuments(await getServiceContext(), documentFilterSchema.parse(filter));
}

/**
 * Documents linked to one client or project, archived ones left out. The Documentos tab serves CLIENT and PROJECT only
 * (the documents filter has facets for these two); any other entity gets an empty page.
 */
export async function listEntityDocuments(entity: EntityRef) {
  if (entity.type !== "CLIENT" && entity.type !== "PROJECT") {
    return { items: [], total: 0, page: 1, pageSize: ENTITY_TAB_PAGE_SIZE };
  }
  const facet = entity.type === "CLIENT" ? { clientId: [entity.id] } : { projectId: [entity.id] };
  return listDocuments({ ...facet, pageSize: ENTITY_TAB_PAGE_SIZE });
}

/** Category chips of the Documentos tab: every category, with its types (no input). */
export async function listDocumentCategories() {
  return listCategories();
}

/**
 * What the signed-in role may do with documents, for the tab's controls: attaching (create) and unlinking
 * (update). Hiding a control is cosmetic; the actions check the same grants again (C13).
 */
export async function getDocumentPermissions() {
  const { user } = await getServiceContext();
  return {
    canCreate: can(user, "create", "document"),
    canUpdate: can(user, "update", "document"),
  };
}

/** `/documents` overview (PRD §8.9.5): every role reads documents (`document` READ). */
export async function getDocumentsOverview() {
  return documents.getDocumentsOverview(
    await getServiceContext(),
    getDocumentsOverviewInputSchema.parse({}),
  );
}

/** One document; pages call `notFound()` when it throws `NOT_FOUND`. */
export async function getDocument(id: string) {
  return documents.getDocument(await getServiceContext(), documentIdInputSchema.parse({ id }));
}

/**
 * The record a new document is linked to when it is created from a client or a project
 * (`/documents/new?entityType=&entityId=`), labelled the way the search actions label it. A record that cannot be
 * read (missing, archived, not visible) or any other entity type leaves the document unlinked.
 */
export async function documentLinkPrefill(
  entityType: string | undefined,
  entityId: string | undefined,
): Promise<EntityRef[]> {
  if (!entityType || !idSchema.safeParse(entityId).success) return [];
  const id = entityId as string;
  try {
    if (entityType === "CLIENT") {
      const client = await getClient(id);
      if (client.archivedAt) return [];
      return [{ type: "CLIENT", id, code: client.code, label: client.tradeName }];
    }
    if (entityType === "PROJECT") {
      const project = await getProject(id);
      if (project.archivedAt) return [];
      return [{ type: "PROJECT", id, code: project.code, label: project.name }];
    }
    return [];
  } catch (error) {
    if (error instanceof ServiceError) return [];
    throw error;
  }
}

// Reads of the document detail (`/documents/[id]`, PRD §8.9.5 "Detalle") and its version pages. Every role reads
// documents (`document` READ); archived ones only with the trash grant (the service decides, C14). A missing,
// hidden or malformed id answers `null`, so the pages answer not-found without telling which case it was.

/** `null` instead of throwing when the record is not there (or the id is malformed). */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    if (error instanceof Error && error.name === "ZodError") return null;
    throw error;
  }
}

export async function readDocumentDetail(id: string): Promise<DocumentDetailDTO | null> {
  return orNull(async () =>
    documents.getDocument(await getServiceContext(), documentIdInputSchema.parse({ id })),
  );
}

/** Version history, newest first, without content (PRD §8.9.3 "Historial"). */
export async function listDocumentVersions(documentId: string): Promise<DocumentVersionRowDTO[]> {
  return documents.listDocumentVersions(
    await getServiceContext(),
    listDocumentVersionsInputSchema.parse({ documentId }),
  );
}

/** One version with its markdown content; `null` when it is not a version of this document. */
export async function readDocumentVersion(
  documentId: string,
  versionId: string,
): Promise<DocumentVersionDetailDTO | null> {
  return orNull(async () =>
    documents.getDocumentVersion(
      await getServiceContext(),
      getDocumentVersionInputSchema.parse({ documentId, versionId }),
    ),
  );
}

/**
 * What the signed-in role may do on the detail: change status, versions and links (`document` UPDATE: Owner, Admin,
 * Member) and read the *Actividad* tab (`activity` READ). Hiding a control is cosmetic; the actions check again (C13).
 */
export async function getDocumentDetailPermissions() {
  const { user } = await getServiceContext();
  return {
    canUpdate: can(user, "update", "document"),
    canReadActivity: can(user, "read", "activity"),
  };
}

/**
 * The bytes behind a version, as the version file route serves them (view and download). Hito 1 has no object
 * storage: a PDF is rendered by the route from the document's own data, markdown is the version content, a link is
 * a redirect, and any other file is a placeholder with its stored name. Hito 2 swaps this for a presigned URL.
 */
export type VersionFile =
  | { kind: "pdf"; fileName: string; title: string; versionNumber: number }
  | { kind: "markdown"; fileName: string; content: string }
  | { kind: "external"; url: string }
  | { kind: "file"; fileName: string; mimeType: string };

/** Hito 1 bytes of a PDF version (no object storage yet); used by the version file route. */
export { samplePdf };

export async function readVersionFile(
  documentId: string,
  versionId: string,
): Promise<VersionFile | null> {
  const [doc, version] = await Promise.all([
    readDocumentDetail(documentId),
    readDocumentVersion(documentId, versionId),
  ]);
  if (!doc || !version) return null;
  if (version.format === "MARKDOWN") {
    return {
      kind: "markdown",
      fileName: `${doc.code}-v${version.versionNumber}.md`,
      content: version.content ?? "",
    };
  }
  if (version.format === "ENLACE")
    return version.url ? { kind: "external", url: version.url } : null;
  if (!version.file) return null;
  if (version.file.mimeType === "application/pdf") {
    return {
      kind: "pdf",
      fileName: version.file.originalName,
      title: doc.title,
      versionNumber: version.versionNumber,
    };
  }
  return { kind: "file", fileName: version.file.originalName, mimeType: version.file.mimeType };
}
