import "server-only";
import { getServerApi } from "@/lib/api/server";

/** Settings → Tipos de documento: every category in order, each with its types (active or not). */
export async function listDocumentCategories() {
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/document-categories");
  if (!data) throw new Error(`GET /api/v1/document-categories failed with ${response.status}`);
  return data;
}
