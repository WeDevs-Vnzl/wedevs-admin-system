"use server";

import {
  expandNodeInputSchema,
  getEntityGraphInputSchema,
  getGlobalGraphInputSchema,
} from "@/lib/validators/graph";
import * as graph from "@/mocks/services/graph";
import { defineAction } from "@/server/actions/define-action";

// Graph reads from the canvas ("Expandir", "+N más", the archived toggle, the global filters). Reads span every
// module, so the action only requires a session; the service applies the per-type `read` grant and the trash
// grant for archived nodes (PRD §12 `graph`).

export const expandNodeAction = defineAction({
  permission: "authenticated",
  input: expandNodeInputSchema,
  handler: (ctx, data) => graph.expandNode(ctx, data),
});

export const getEntityGraphAction = defineAction({
  permission: "authenticated",
  input: getEntityGraphInputSchema,
  handler: (ctx, data) => graph.getEntityGraph(ctx, data),
});

export const getGlobalGraphAction = defineAction({
  permission: "authenticated",
  input: getGlobalGraphInputSchema,
  handler: (ctx, data) => graph.getGlobalGraph(ctx, data),
});
