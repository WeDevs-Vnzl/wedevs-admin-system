"use server";

import { apiAction } from "@/lib/api/action";
import { entityHref } from "@/lib/entity-routes";
import {
  restoreFromTrashInputSchema,
  type TrashFilterInput,
} from "@/lib/validators/trash";
import * as trash from "@/mocks/services/trash"; // MOCK — until cleanup
import { defineAction } from "@/server/actions/define-action";
import { toTrashListQuery } from "./api-query";

const SETTINGS_TRASH_PATH = "/settings/trash";

/** Reads the trash for the table (Owner and Admin). The BE decides who may read it (`can()`). */
export const listTrashAction = apiAction({
  call: (input: TrashFilterInput, api) =>
    api.GET("/api/v1/trash", { params: { query: toTrashListQuery(input) } }),
});

/**
 * Takes a record out of the trash (HU-28 CA2: back to its previous state, logged as `RESTORE`). The service
 * also checks the record's own module; a collision comes back as `CONFLICT` with a `trash.errors.*` key.
 */
export const restoreFromTrashAction = defineAction({
  permission: { action: "restore", resource: "trash" },
  input: restoreFromTrashInputSchema,
  revalidate: (data) => {
    const href = entityHref({ type: data.entityType, id: data.entityId });
    return href ? [SETTINGS_TRASH_PATH, href] : [SETTINGS_TRASH_PATH];
  },
  handler: (ctx, data) => trash.restoreFromTrash(ctx, data), // MOCK — until cleanup
});
