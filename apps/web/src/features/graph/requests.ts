import {
  expandNodeInputSchema,
  getEntityGraphInputSchema,
  getGlobalGraphInputSchema,
  GLOBAL_GRAPH_DEFAULT_TYPES,
} from "@/lib/validators/graph";
import type { z } from "@/lib/validators/zod";

// Request builders for the graph endpoints (`api-contract.md` §2): the contract's query shapes, built from the
// callers' inputs. Pure: no client, no Server Action, so `queries.ts` and `actions.ts` share one mapping. The BE
// validates every value; these builders only shape them.

/** Caller inputs (schema input types: fields with a schema default stay optional). */
export type EntityGraphRequest = z.input<typeof getEntityGraphInputSchema>;
export type ExpandNodeRequest = z.input<typeof expandNodeInputSchema>;
export type GlobalGraphRequest = z.input<typeof getGlobalGraphInputSchema>;

/** The contract sends booleans as the query strings `"true"` / `"false"`; an unset flag is omitted. */
export function flag(value: boolean | undefined): "true" | "false" | undefined {
  if (value === undefined) return undefined;
  return value ? "true" : "false";
}

/** `GET /api/v1/graph/{type}/{id}`: the record and its relations, depth 1 unless asked otherwise. */
export function entityGraphParams(input: EntityGraphRequest) {
  return {
    path: { type: input.type, id: input.id },
    query: {
      depth: input.depth ?? 1,
      include: input.include,
      includeArchived: flag(input.includeArchived),
    },
  };
}

/** `GET /api/v1/graph/nodes/{nodeId}/neighbours`: one page of at most 50 neighbours of a node. */
export function expandNodeParams(input: ExpandNodeRequest) {
  return {
    path: { nodeId: input.nodeId },
    query: {
      cursor: input.cursor,
      include: input.include,
      includeArchived: flag(input.includeArchived),
    },
  };
}

/**
 * `GET /api/v1/graph`: clients, projects and documents with no filters unless given. The flags default to
 * `false`, as the contract's schema does.
 */
export function globalGraphParams(input: GlobalGraphRequest) {
  const filters = input.filters ?? {};
  return {
    query: {
      include: input.include ?? [...GLOBAL_GRAPH_DEFAULT_TYPES],
      statuses: filters.statuses,
      tagIds: filters.tagIds,
      technologyIds: filters.technologyIds,
      clientIds: filters.clientIds,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      onlyActive: flag(filters.onlyActive ?? false),
      includeArchived: flag(filters.includeArchived ?? false),
    },
  };
}
