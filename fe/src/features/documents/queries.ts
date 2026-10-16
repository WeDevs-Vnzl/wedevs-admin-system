import "server-only";
import { listDocumentCategories as listCategories } from "@/features/catalogs/queries";
import { getClient } from "@/features/clients/queries";
import { getProject } from "@/features/projects/queries";
import { idSchema, type EntityRef } from "@/lib/validators/common";
import {
  documentFilterSchema,
  documentIdInputSchema,
  getDocumentsOverviewInputSchema,
  type DocumentFilterInput,
} from "@/lib/validators/documents";
import * as documents from "@/mocks/services/documents";
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
