import "server-only";
import { listDocumentCategories as listCategories } from "@/features/catalogs/queries";
import { documentFilterSchema, type DocumentFilterInput } from "@/lib/validators/documents";
import * as documents from "@/mocks/services/documents";
import { getServiceContext } from "@/server/context";
import { can } from "@/server/auth/permissions";

/** Rows of the entity's Documentos tab fit one page: the tab shows every linked document, no paging. */
const ENTITY_TAB_PAGE_SIZE = 100;

/** The records a Documentos tab can belong to in H1-B2 (the documents filter has facets for these two only). */
export type DocumentsTabEntity = { type: "CLIENT" | "PROJECT"; id: string };

export async function listDocuments(filter: DocumentFilterInput = {}) {
  return documents.listDocuments(await getServiceContext(), documentFilterSchema.parse(filter));
}

/** Documents linked to one client or project, archived ones left out. */
export async function listEntityDocuments(entity: DocumentsTabEntity) {
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
