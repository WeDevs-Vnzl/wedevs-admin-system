import "server-only";
import {
  getEntityGraphInputSchema,
  getGlobalGraphInputSchema,
  type GraphNodeType,
} from "@/lib/validators/graph";
import * as graph from "@/mocks/services/graph";
import { getServiceContext } from "@/server/context";
import { ENTITY_GRAPH_TYPES } from "./graph-model";

// Reads for the graph pages (RSC). The session resolves in `getServiceContext`; input is parsed with the contract
// schema. The detail graph loads every type, technologies and tags included, so the "Tipo" and "Etiqueta"
// filters work on the loaded data without another request; the canvas hides those two types by default.

export async function getEntityGraph(type: GraphNodeType, id: string) {
  return graph.getEntityGraph(
    await getServiceContext(),
    getEntityGraphInputSchema.parse({ type, id, include: ENTITY_GRAPH_TYPES }),
  );
}

export async function getGlobalGraph() {
  return graph.getGlobalGraph(await getServiceContext(), getGlobalGraphInputSchema.parse({}));
}
