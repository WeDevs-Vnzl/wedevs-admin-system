import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { dateOnlySchema, idSchema } from '../../../../shared/interface/common.schemas';
import {
  GRAPH_CURSOR_MAX_LENGTH,
  GRAPH_MAX_DEPTH,
  GRAPH_NODE_TYPE_VALUES,
} from '../../application/ports/graph-read.port';

export const graphNodeTypeSchema = z.enum(GRAPH_NODE_TYPE_VALUES);

/** One value or repeated query keys (`?include=CLIENT&include=PROJECT`). */
const multi = <T extends z.ZodType<string>>(item: T) => z.union([item, z.array(item)]).optional();
const flag = z.enum(['true', 'false']).optional();

/**
 * Query of `GET /graph/{type}/{id}`. The use case checks the same bounds again, so an internal caller
 * cannot bypass them.
 */
export const entityGraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(GRAPH_MAX_DEPTH).optional(),
  include: multi(graphNodeTypeSchema),
  includeArchived: flag,
});
export class EntityGraphQueryDto extends createZodDto(entityGraphQuerySchema) {}

/** Query of `GET /graph/nodes/{nodeId}/neighbours`. */
export const nodeNeighboursQuerySchema = z.object({
  cursor: z.string().min(1).max(GRAPH_CURSOR_MAX_LENGTH).optional(),
  include: multi(graphNodeTypeSchema),
  includeArchived: flag,
});
export class NodeNeighboursQueryDto extends createZodDto(nodeNeighboursQuerySchema) {}

/** Query of `GET /graph`. */
export const globalGraphQuerySchema = z.object({
  include: multi(graphNodeTypeSchema),
  statuses: multi(z.string().min(1).max(40)),
  tagIds: multi(idSchema),
  technologyIds: multi(idSchema),
  clientIds: multi(idSchema),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  onlyActive: flag,
  includeArchived: flag,
});
export class GlobalGraphQueryDto extends createZodDto(globalGraphQuerySchema) {}

/** Card data: money is a decimal string (C15), the number arm is for counts. */
const metaValueSchema = z.union([z.string(), z.number()]).nullable();

export const graphNodeSchema = z.object({
  /** `${type}:${entityId}` */
  id: z.string(),
  type: graphNodeTypeSchema,
  entityId: z.string(),
  label: z.string(),
  code: z.string().optional(),
  status: z.string().optional(),
  meta: z.record(z.string(), metaValueSchema),
  archived: z.boolean(),
  /** Every visible relation of the node, to show "+N". */
  degree: z.number().int().nonnegative(),
});

export const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  /** Stable key the UI translates: `participa`, `paga`, ... */
  relation: z.string(),
  label: z.string().optional(),
});

export const graphTruncatedSchema = z.object({
  nodeId: z.string(),
  remaining: z.number().int().positive(),
  /** Pass to `GET /graph/nodes/{nodeId}/neighbours?cursor=` for the next page. */
  cursor: z.string(),
});

export const graphResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  truncated: z.array(graphTruncatedSchema),
});
export class GraphResponseDto extends createZodDto(graphResponseSchema) {}

export const graphStatsSchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  mostConnected: z.array(
    z.object({
      nodeId: z.string(),
      type: graphNodeTypeSchema,
      label: z.string(),
      degree: z.number().int().nonnegative(),
    }),
  ),
});

export const globalGraphResponseSchema = graphResponseSchema.extend({ stats: graphStatsSchema });
export class GlobalGraphResponseDto extends createZodDto(globalGraphResponseSchema) {}
