"use server";

import type { RestoreFromTrashDto } from "@/lib/api/types/trash";
import { apiAction } from "@/lib/api/action";
import { entityHref } from "@/lib/entity-routes";
import type { TrashFilterInput } from "@/lib/validators/trash";
import { toTrashListQuery } from "./api-query";

const SETTINGS_TRASH_PATH = "/settings/trash";

/** Reads the trash for the table (Owner and Admin). The BE decides who may read it (`can()`). */
export const listTrashAction = apiAction({
  call: (input: TrashFilterInput, api) =>
    api.GET("/api/v1/trash", { params: { query: toTrashListQuery(input) } }),
});

/**
 * Takes a record out of the trash (HU-28 CA2: back to its previous state, logged as `RESTORE`). The BE checks
 * the permission and the record's own module; a collision comes back as `CONFLICT` with a `trash.errors.*` key
 * and the entity that blocks it.
 */
export const restoreFromTrashAction = apiAction({
  call: (input: RestoreFromTrashDto, api) => api.POST("/api/v1/trash/restore", { body: input }),
  revalidate: (input) => {
    const href = entityHref({ type: input.entityType, id: input.entityId });
    return href ? [SETTINGS_TRASH_PATH, href] : [SETTINGS_TRASH_PATH];
  },
});
