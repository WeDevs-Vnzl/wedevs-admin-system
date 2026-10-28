"use server";

import { cookies } from "next/headers";
import { userRoleSchema } from "@/lib/validators/enums";
import { z } from "@/lib/validators/zod";
import { MOCK_ROLE_COOKIE } from "@/mocks/session";
import * as session from "@/mocks/services/session";
import { defineAction } from "@/server/actions/define-action";

// MOCK — Hito 1 only: "View as role" and "Reset mock data" of the user menu (DT-32, DT-40). Both stay open
// to every signed-in role: someone viewing as Viewer must be able to switch back. Removed with
// `src/mocks/` at the close of Hito 2.

export const setMockRoleAction = defineAction({
  permission: "authenticated",
  input: z.object({ role: userRoleSchema }),
  revalidate: [{ path: "/", type: "layout" }],
  handler: async (ctx, data) => {
    const result = await session.setMockRole(ctx, data);
    (await cookies()).set(MOCK_ROLE_COOKIE, result.role, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
    return result;
  },
});

export const resetMockDataAction = defineAction({
  permission: "authenticated",
  input: z.object({}),
  revalidate: [{ path: "/", type: "layout" }],
  handler: (ctx) => session.resetMockData(ctx),
});
