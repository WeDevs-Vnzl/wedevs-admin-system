"use server";

import { z } from "@/lib/validators/zod";
import * as session from "@/mocks/services/session";
import { defineAction } from "@/server/actions/define-action";

// MOCK — until cleanup: "Reset mock data" of the user menu (DT-40). Removed with `src/mocks/` at CLEAN.

export const resetMockDataAction = defineAction({
  permission: "authenticated",
  input: z.object({}),
  revalidate: [{ path: "/", type: "layout" }],
  handler: (ctx) => session.resetMockData(ctx),
});
