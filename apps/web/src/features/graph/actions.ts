"use server";

import { apiAction } from "@/lib/api/action";
import type { GraphResponse } from "@/lib/validators/graph";
import {
  entityGraphParams,
  expandNodeParams,
  globalGraphParams,
  type EntityGraphRequest,
  type ExpandNodeRequest,
  type GlobalGraphRequest,
} from "./requests";

// Graph reads from the canvas ("Expandir", "+N más", the archived toggle, the global filters). Thin proxies (C10):
// token → one API call → error mapping. The BE applies the per-type `read` grant and the trash grant for archived
// nodes (PRD §12 `graph`, DT-180); the FE shows what it gets. No revalidation: graph reads change nothing.

export const expandNodeAction = apiAction<ExpandNodeRequest, GraphResponse>({
  call: (input, api) =>
    api.GET("/api/v1/graph/nodes/{nodeId}/neighbours", { params: expandNodeParams(input) }),
});

export const getEntityGraphAction = apiAction<EntityGraphRequest, GraphResponse>({
  call: (input, api) =>
    api.GET("/api/v1/graph/{type}/{id}", { params: entityGraphParams(input) }),
});

export const getGlobalGraphAction = apiAction<GlobalGraphRequest, GraphResponse>({
  call: (input, api) => api.GET("/api/v1/graph", { params: globalGraphParams(input) }),
});
