"use server";

import { searchGlobalInputSchema } from "@/lib/validators/search";
import * as search from "@/mocks/services/search";
import { defineAction } from "@/server/actions/define-action";

// Cmd+K record search (PRD §7.6, HU-26). Results span every module, so the action only requires a session;
// the service applies the per-type `read` grant and the trash grant for archived rows (PRD §12 `search`).
export const searchGlobalAction = defineAction({
  permission: "authenticated",
  input: searchGlobalInputSchema,
  handler: (ctx, data) => search.searchGlobal(ctx, data),
});
