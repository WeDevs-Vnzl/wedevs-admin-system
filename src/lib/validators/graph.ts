import { z } from "./zod";
import { VALIDATION_MESSAGES, dateOnlySchema, idSchema } from "./common";

/**
 * Graph data contract — exactly PRD §8.12.5. Queries are resolved with specific per-relation queries,
 * not a generic edge table; `getGlobalGraph` is cached under the tag `graph`, invalidated on every
 * mutation (IOU-01).
 *
 * ```ts
 * type GraphNodeType = 'CLIENT' | 'CONTACT' | 'PROJECT' | 'INVOICE' | 'PAYMENT'
 *   | 'EXPENSE' | 'ACCOUNT' | 'DOCUMENT' | 'NOTE' | 'TECHNOLOGY' | 'TAG';
 * ```
 */

export const GRAPH_NODE_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "ACCOUNT",
  "DOCUMENT",
  "NOTE",
  "TECHNOLOGY",
  "TAG",
] as const;
export const graphNodeTypeSchema = z.enum(GRAPH_NODE_TYPE_VALUES);
export type GraphNodeType = z.infer<typeof graphNodeTypeSchema>;

/** Node ids are `${type}:${entityId}`. */
export function graphNodeId(type: GraphNodeType, entityId: string): string {
  return `${type}:${entityId}`;
}

/** Splits `${type}:${entityId}`; `null` when it is not a valid node id. */
export function parseGraphNodeId(nodeId: string): { type: GraphNodeType; entityId: string } | null {
  const separator = nodeId.indexOf(":");
  if (separator <= 0) return null;
  const type = graphNodeTypeSchema.safeParse(nodeId.slice(0, separator));
  const entityId = idSchema.safeParse(nodeId.slice(separator + 1));
  return type.success && entityId.success ? { type: type.data, entityId: entityId.data } : null;
}

/** Node id as a field: `${type}:${entityId}`. */
export const graphNodeIdSchema = z.string().refine((value) => parseGraphNodeId(value) !== null, {
  message: VALIDATION_MESSAGES.invalidId,
});

/** Types shown by default in the global graph (PRD §8.12.4): everything else is toggled in filters. */
export const GLOBAL_GRAPH_DEFAULT_TYPES = [
  "CLIENT",
  "PROJECT",
  "DOCUMENT",
] as const satisfies readonly GraphNodeType[];

/** At most 50 neighbours per expansion; beyond that an aggregated "+N more" node pages the rest. */
export const GRAPH_EXPANSION_LIMIT = 50;

// ───────────────────────────── Response (§8.12.5) ─────────────────────────────

/**
 * `meta` carries the card and hover-card data. Money stays a decimal string here as everywhere (C15):
 * the `number` arm is for counts and similar plain numbers.
 */
export const graphNodeMetaSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()]),
);

export const graphNodeSchema = z
  .object({
    /** `${type}:${entityId}` */
    id: z.string(),
    type: graphNodeTypeSchema,
    entityId: z.string(),
    label: z.string(),
    code: z.string().optional(),
    status: z.string().optional(),
    meta: graphNodeMetaSchema,
    archived: z.boolean(),
    /** Total number of relations (to show "+N"). */
    degree: z.number().int().nonnegative(),
  })
  .refine((node) => node.id === graphNodeId(node.type, node.entityId), {
    message: VALIDATION_MESSAGES.invalidId,
    path: ["id"],
  });
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string(),
  /** Node id. */
  source: z.string(),
  /** Node id. */
  target: z.string(),
  /** `'participa'`, `'paga'`, … */
  relation: z.string(),
  label: z.string().optional(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphTruncatedSchema = z.object({
  nodeId: z.string(),
  remaining: z.number().int().positive(),
});
export type GraphTruncated = z.infer<typeof graphTruncatedSchema>;

export const graphResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  truncated: z.array(graphTruncatedSchema),
});
export type GraphResponse = z.infer<typeof graphResponseSchema>;

// ───────────────────────────── Inputs ─────────────────────────────

const includeSchema = z.array(graphNodeTypeSchema).min(1).max(GRAPH_NODE_TYPE_VALUES.length);

/**
 * `getEntityGraph({ type, id, depth = 1, include?, includeArchived? })`: the root and its relations
 * (depth 1 by default); further neighbours load through `expandNode`.
 */
export const getEntityGraphInputSchema = z.object({
  type: graphNodeTypeSchema,
  id: idSchema,
  depth: z.number().int().min(1).max(3).default(1),
  include: includeSchema.optional(),
  includeArchived: z.boolean().optional(),
});
export type GetEntityGraphInput = z.infer<typeof getEntityGraphInputSchema>;

/**
 * `expandNode({ nodeId, include?, cursor? })`: neighbours of one node, at most `GRAPH_EXPANSION_LIMIT`;
 * `cursor` (from the "+N more" node) loads the next page.
 */
export const expandNodeInputSchema = z.object({
  nodeId: graphNodeIdSchema,
  include: includeSchema.optional(),
  cursor: z.string().min(1).max(256).optional(),
});
export type ExpandNodeInput = z.infer<typeof expandNodeInputSchema>;

/** Filters of the global graph (the detail graph's filters plus technology, project status, only active). */
export const globalGraphFiltersSchema = z.object({
  /** Node statuses (raw enum values of their module). */
  statuses: z.array(z.string().min(1).max(40)).max(40).optional(),
  tagIds: z.array(idSchema).max(50).optional(),
  technologyIds: z.array(idSchema).max(60).optional(),
  clientIds: z.array(idSchema).max(50).optional(),
  /** Date range over the nodes' main date. */
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  /** Hides inactive clients, finished projects and archived nodes. */
  onlyActive: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
});
export type GlobalGraphFilters = z.infer<typeof globalGraphFiltersSchema>;

/** `getGlobalGraph({ include, filters })`. */
export const getGlobalGraphInputSchema = z.object({
  include: includeSchema.default([...GLOBAL_GRAPH_DEFAULT_TYPES]),
  filters: globalGraphFiltersSchema.default({ onlyActive: false, includeArchived: false }),
});
export type GetGlobalGraphInput = z.infer<typeof getGlobalGraphInputSchema>;

// ───────────────────────────── Services (PRD §12 `graph`) ─────────────────────────────

/**
 * `graph` services. Every service is `fn(ctx, input) → Promise<GraphResponse>` (C9, C11). Reading is
 * allowed to every role that can read the underlying records; archived nodes need Owner/Admin.
 */
export type GraphService<Ctx = unknown> = {
  getEntityGraph: (ctx: Ctx, input: GetEntityGraphInput) => Promise<GraphResponse>;
  expandNode: (ctx: Ctx, input: ExpandNodeInput) => Promise<GraphResponse>;
  getGlobalGraph: (ctx: Ctx, input: GetGlobalGraphInput) => Promise<GraphResponse>;
};
