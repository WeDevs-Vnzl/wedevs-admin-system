import "server-only";
import { listDocumentCategories as listCategories } from "@/features/catalogs/queries";
import { getClient } from "@/features/clients/queries";
import { getProject } from "@/features/projects/queries";
import type { ApiResponseLike } from "@/lib/api/errors";
import { toActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import { idSchema, type EntityRef } from "@/lib/validators/common";
import {
  documentFilterSchema,
  type DocumentDetailDTO,
  type DocumentFilterInput,
  type DocumentListRowDTO,
  type DocumentsOverviewDTO,
  type DocumentVersionDetailDTO,
  type DocumentVersionRowDTO,
} from "@/lib/validators/documents";
import { can } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/service-error";
import { toDocumentListQuery } from "./api-query";
import { toDocumentDetail, toDocumentPage, toDocumentsOverview } from "./mappers";

/** Largest page the documents list accepts; the tab reads page after page until it holds every linked document. */
const ENTITY_TAB_PAGE_SIZE = 100;

/**
 * Unwraps a read. A BE `404` throws `ServiceError("NOT_FOUND")`, `403` `FORBIDDEN` and `422` `VALIDATION` (message and
 * field errors kept): notes and the pages catch these until CLEAN replaces `@/lib/service-error` and its consumers.
 */
function unwrap<T>(result: ApiResponseLike<T>, what: string): T {
  const mapped = toActionResult(result);
  if (mapped.ok) return mapped.data;
  const { code, message, fieldErrors } = mapped.error;
  if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "VALIDATION") {
    throw new ServiceError(code, { message, ...(fieldErrors ? { fieldErrors } : {}) });
  }
  throw new Error(`${what} failed with ${result.response.status}`);
}

export async function listDocuments(filter: DocumentFilterInput = {}) {
  const api = await getServerApi();
  return toDocumentPage(
    unwrap(
      await api.GET("/api/v1/documents", {
        params: { query: toDocumentListQuery(documentFilterSchema.parse(filter)) },
      }),
      "GET /api/v1/documents",
    ),
  );
}

/** The facet of `GET /api/v1/documents` that filters by each link type (HU-20 CA1). */
const ENTITY_FACETS = {
  CLIENT: "clientId",
  CONTACT: "contactId",
  PROJECT: "projectId",
  INVOICE: "invoiceId",
  PAYMENT: "paymentId",
  EXPENSE: "expenseId",
} as const;

function isFacetType(type: string): type is keyof typeof ENTITY_FACETS {
  return Object.hasOwn(ENTITY_FACETS, type);
}

/**
 * Every document linked to one record, archived ones left out: the Documentos tab has no paging, and its category
 * chips count and filter over all of them (not one page capped at 100). Every link type with a facet is served
 * (client, contact, project, invoice, payment, expense); any other entity gets an empty list with no call.
 */
export async function listEntityDocuments(
  entity: EntityRef,
): Promise<{ items: DocumentListRowDTO[]; total: number }> {
  if (!isFacetType(entity.type)) return { items: [], total: 0 };
  const facet = { [ENTITY_FACETS[entity.type]]: [entity.id] };
  const items: DocumentListRowDTO[] = [];
  for (let page = 1; ; page += 1) {
    const result = await listDocuments({ ...facet, page, pageSize: ENTITY_TAB_PAGE_SIZE });
    items.push(...result.items);
    if (result.items.length < ENTITY_TAB_PAGE_SIZE || items.length >= result.total) {
      return { items, total: items.length };
    }
  }
}

/** Category chips of the Documentos tab: every category, with its types (no input). */
export async function listDocumentCategories() {
  return listCategories();
}

/**
 * What the signed-in role may do with documents, for the tab's controls: attaching (create), unlinking (update) and
 * seeing the archived ones (the trash roles: `archived` is refused for any other role). Hiding a control is
 * cosmetic; the BE checks the same grants again (C13).
 */
export async function getDocumentPermissions() {
  const user = await requireSessionUser();
  return {
    canCreate: can(user, "create", "document"),
    canUpdate: can(user, "update", "document"),
    canRestore: can(user, "restore", "document"),
  };
}

/** `/documents` overview (PRD §8.9.5): every role reads documents (`document` READ). */
export async function getDocumentsOverview(): Promise<DocumentsOverviewDTO> {
  const api = await getServerApi();
  return toDocumentsOverview(
    unwrap(await api.GET("/api/v1/documents/overview"), "GET /api/v1/documents/overview"),
  );
}

/**
 * One document; pages call `notFound()` when it throws `NOT_FOUND`. A BE `404`/`403`/`422` throws the matching
 * `ServiceError`; a malformed id answers like an unknown one, without calling the BE.
 */
export async function getDocument(id: string): Promise<DocumentDetailDTO> {
  if (!idSchema.safeParse(id).success) throw new ServiceError("NOT_FOUND");
  const api = await getServerApi();
  return toDocumentDetail(
    unwrap(
      await api.GET("/api/v1/documents/{id}", { params: { path: { id } } }),
      `GET /api/v1/documents/${id}`,
    ),
  );
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
// documents (`document` READ); archived ones only with the trash grant (the BE decides, C14). A missing, hidden or
// malformed id answers `null`, so the pages answer not-found without telling which case it was.

/** `null` instead of throwing when the record is not there or not visible (the same not-found either way). */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      return null;
    }
    throw error;
  }
}

export async function readDocumentDetail(id: string): Promise<DocumentDetailDTO | null> {
  return orNull(() => getDocument(id));
}

/** Version history, newest first, without content (PRD §8.9.3 "Historial"). */
export async function listDocumentVersions(documentId: string): Promise<DocumentVersionRowDTO[]> {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/documents/{id}/versions", { params: { path: { id: documentId } } }),
    `GET /api/v1/documents/${documentId}/versions`,
  );
}

/** One version with its markdown content; `null` when it is not a version of this document. */
export async function readDocumentVersion(
  documentId: string,
  versionId: string,
): Promise<DocumentVersionDetailDTO | null> {
  if (!idSchema.safeParse(documentId).success || !idSchema.safeParse(versionId).success) {
    return null;
  }
  return orNull(async () => {
    const api = await getServerApi();
    return unwrap(
      await api.GET("/api/v1/documents/{id}/versions/{versionId}", {
        params: { path: { id: documentId, versionId } },
      }),
      `GET /api/v1/documents/${documentId}/versions/${versionId}`,
    );
  });
}

/**
 * What the signed-in role may do on the detail: change status, versions and links (`document` UPDATE: Owner, Admin,
 * Member) and read the *Actividad* tab (`activity` READ). Hiding a control is cosmetic; the BE checks again (C13).
 */
export async function getDocumentDetailPermissions() {
  const user = await requireSessionUser();
  return {
    canUpdate: can(user, "update", "document"),
    canReadActivity: can(user, "read", "activity"),
  };
}
