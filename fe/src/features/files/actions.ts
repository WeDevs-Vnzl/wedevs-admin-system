"use server";

import { confirmUploadInputSchema, requestUploadInputSchema } from "@/lib/validators/files";
import * as files from "@/mocks/services/files";
import { defineAction, type ActionPermission } from "@/server/actions/define-action";
import { can } from "@/server/auth/permissions";
import { ServiceError } from "@/server/errors";

// The matrix has no `file` resource: a file is always attached to something. Whoever can create one of
// these records may upload; payment receipts additionally need `payment` (checked in the handler).
const UPLOADERS: readonly [ActionPermission, ...ActionPermission[]] = [
  { action: "create", resource: "document" },
  { action: "create", resource: "note" },
  { action: "create", resource: "invoice" },
  { action: "create", resource: "payment" },
  { action: "create", resource: "expense" },
];

/** `UploadAdapter.requestUpload` (C23). Hito 1 returns a mock file id and no upload URL. */
export const requestUploadAction = defineAction({
  permission: UPLOADERS,
  input: requestUploadInputSchema,
  handler: async (ctx, data) => {
    if (data.context === "payment_receipt" && !can(ctx.user, "create", "payment")) {
      throw new ServiceError("FORBIDDEN");
    }
    return files.requestUpload(ctx, data);
  },
});

/** `UploadAdapter.confirmUpload`: the file becomes `READY`. */
export const confirmUploadAction = defineAction({
  permission: UPLOADERS,
  input: confirmUploadInputSchema,
  handler: (ctx, data) => files.confirmUpload(ctx, data),
});
