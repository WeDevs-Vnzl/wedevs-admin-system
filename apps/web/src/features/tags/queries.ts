import "server-only";
import { can } from "@/server/auth/permissions";
import { tagFilterSchema, tagIdInputSchema, type TagFilterInput } from "@/lib/validators/tags";
import * as tags from "@/mocks/services/tags";
import { getServiceContext } from "@/server/context";
import { CREATE_TAG_GRANTS } from "./grants";

/** The tag catalogue with usage counts, for the Settings table. */
export async function getTags(filter: TagFilterInput = {}) {
  return tags.listTags(await getServiceContext(), tagFilterSchema.parse(filter));
}

export async function getTag(id: string) {
  return tags.getTag(await getServiceContext(), tagIdInputSchema.parse({ id }));
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
