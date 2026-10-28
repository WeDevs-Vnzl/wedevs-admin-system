import "server-only";
import * as documentTypes from "@/mocks/services/document-types";
import { getServiceContext } from "@/server/context";

/** Settings → Tipos de documento: every category in order, each with its types (active or not). */
export async function listDocumentCategories() {
  return documentTypes.listDocumentCategories(await getServiceContext());
}
