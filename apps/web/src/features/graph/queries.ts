import "server-only";
import { toActionResult, type ApiActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { GraphNodeType, GraphResponse } from "@/lib/validators/graph";
import { ENTITY_GRAPH_TYPES } from "./graph-model";
import { entityGraphParams, globalGraphParams } from "./requests";

// Reads for the graph pages (RSC). The detail graph loads every type, technologies and tags included, so the
// "Tipo" and "Etiqueta" filters work on the loaded data without another request; the canvas hides those two types
// by default. A failed read is a result, not a throw: the screen decides (not-found page or error state).

export async function getEntityGraph(
  type: GraphNodeType,
  id: string,
): Promise<ApiActionResult<GraphResponse>> {
  const api = await getServerApi();
  return toActionResult<GraphResponse>(
    await api.GET("/api/v1/graph/{type}/{id}", {
      params: entityGraphParams({ type, id, include: ENTITY_GRAPH_TYPES }),
    }),
  );
}

export async function getGlobalGraph(): Promise<ApiActionResult<GraphResponse>> {
  const api = await getServerApi();
  return toActionResult<GraphResponse>(
    await api.GET("/api/v1/graph", { params: globalGraphParams({}) }),
  );
}
