import { ValidationFailedError } from '../../../shared/domain/domain-error';

export const GRAPH_NODE_TYPE_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'ACCOUNT',
  'DOCUMENT',
  'NOTE',
  'TECHNOLOGY',
  'TAG',
] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPE_VALUES)[number];

/** Types shown by default in the global graph (PRD §8.12.4). */
export const GLOBAL_GRAPH_DEFAULT_TYPES = [
  'CLIENT',
  'PROJECT',
  'DOCUMENT',
] as const satisfies readonly GraphNodeType[];

/** At most 50 neighbours per expansion; the rest is paged through a cursor. */
export const GRAPH_EXPANSION_LIMIT = 50;
export const GRAPH_MAX_DEPTH = 3;
export const GRAPH_CURSOR_MAX_LENGTH = 256;

/** Stable relation keys the UI translates (§8.12.3). */
export const GRAPH_RELATION_KEYS = [
  'contacto',
  'participa',
  'facturado_a',
  'incluido_en',
  'paga',
  'pago',
  'acreditado_en',
  'pagado_desde',
  'imputado_a',
  'adjunto_a',
  'anotado_en',
  'usa',
  'etiquetado',
] as const;
export type GraphRelationKey = (typeof GRAPH_RELATION_KEYS)[number];

export function isGraphRelationKey(value: string): value is GraphRelationKey {
  return (GRAPH_RELATION_KEYS as readonly string[]).includes(value);
}

const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Node ids are `${type}:${entityId}`. */
export function graphNodeId(type: GraphNodeType, entityId: string): string {
  return `${type}:${entityId}`;
}

/** Splits `${type}:${entityId}`; `null` when it is not a valid node id. */
export function parseGraphNodeId(nodeId: string): { type: GraphNodeType; entityId: string } | null {
  const separator = nodeId.indexOf(':');
  if (separator <= 0) return null;
  const type = GRAPH_NODE_TYPE_VALUES.find((value) => value === nodeId.slice(0, separator));
  const entityId = nodeId.slice(separator + 1);
  return type !== undefined && ENTITY_ID.test(entityId) ? { type, entityId } : null;
}

/** The cursor is the decimal offset of the next neighbour (the number already loaded). */
export function buildGraphCursor(offset: number): string {
  return String(offset);
}

/** The offset a cursor carries; `null` when it is not a non-negative safe integer. */
export function parseGraphCursor(cursor: string): number | null {
  if (cursor.length === 0 || cursor.length > GRAPH_CURSOR_MAX_LENGTH || !/^\d+$/.test(cursor)) {
    return null;
  }
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) ? offset : null;
}

/** Depth of the entity graph: 1 by default, 1 to 3. */
export function graphDepth(depth: number | undefined): number {
  if (depth === undefined) return 1;
  if (!Number.isInteger(depth) || depth < 1 || depth > GRAPH_MAX_DEPTH) {
    throw new ValidationFailedError({
      message: 'graph.validation.depth',
      fieldErrors: { depth: ['graph.validation.depth'] },
    });
  }
  return depth;
}
