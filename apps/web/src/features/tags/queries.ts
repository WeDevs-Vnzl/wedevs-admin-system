import "server-only";
import { getServerApi } from "@/lib/api/server";
import { tagFilterSchema, tagIdInputSchema, type TagFilterInput } from "@/lib/validators/tags";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/context";
import { toTagListQuery } from "./api-query";
import { CREATE_TAG_GRANTS } from "./grants";

/** The tag catalogue with usage counts, for the Settings table and the graph (`GET /api/v1/tags`). */
export async function getTags(filter: TagFilterInput = {}) {
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/tags", {
    params: { query: toTagListQuery(tagFilterSchema.parse(filter)) },
  });
  if (!data) throw new Error(`GET /api/v1/tags failed with ${response.status}`);
  return data;
}

/** One tag with its usage count (`GET /api/v1/tags/{id}`). */
export async function getTag(id: string) {
  const { id: tagId } = tagIdInputSchema.parse({ id });
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/tags/{id}", {
    params: { path: { id: tagId } },
  });
  if (!data) throw new Error(`GET /api/v1/tags/${tagId} failed with ${response.status}`);
  return data;
}

/** Whether the signed-in user manages the tag catalogue (Settings → Etiquetas: Owner and Admin). */
export async function canManageTags(): Promise<boolean> {
  const ctx = await getServiceContext();
  return can(ctx.user, "read", "settings");
}

/**
 * Whether the signed-in user may create a tag inline from a tag picker ("Crear"): the clients, contacts, notes and
 * projects screens pass this boolean to their components (R13).
 */
export async function canCreateTagsInline(): Promise<boolean> {
  const ctx = await getServiceContext();
  return CREATE_TAG_GRANTS.some(({ action, resource }) => can(ctx.user, action, resource));
}
