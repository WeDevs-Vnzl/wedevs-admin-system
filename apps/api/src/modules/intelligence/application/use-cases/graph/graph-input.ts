import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import { isValidDateOnly } from '../../../../../shared/domain/business-date';
import {
  GRAPH_NODE_TYPE_VALUES,
  parseGraphCursor,
  parseGraphNodeId,
  type GraphNodeType,
} from '../../../domain';

const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const GRAPH_VALIDATION = {
  type: 'graph.validation.type',
  include: 'graph.validation.include',
  cursor: 'graph.validation.cursor',
  nodeId: 'graph.validation.nodeId',
  id: 'validation.id.invalid',
  date: 'validation.date.invalid',
  dateRange: 'graph.validation.dateRange',
  filter: 'graph.validation.filter',
} as const;

function fail(field: string, key: string): never {
  const fieldErrors: FieldErrors = { [field]: [key] };
  throw new ValidationFailedError({ message: key, fieldErrors });
}

const isType = (value: string): value is GraphNodeType =>
  (GRAPH_NODE_TYPE_VALUES as readonly string[]).includes(value);

export function parseNodeType(value: string, field = 'type'): GraphNodeType {
  if (!isType(value)) return fail(field, GRAPH_VALIDATION.type);
  return value;
}

export function parseEntityId(value: string, field = 'id'): string {
  if (!ENTITY_ID.test(value)) return fail(field, GRAPH_VALIDATION.id);
  return value;
}

/** Distinct node types: 1 to all of them, else `fallback` when absent. */
export function parseIncludeTypes(
  include: readonly string[] | undefined,
  fallback: readonly GraphNodeType[],
): ReadonlySet<GraphNodeType> {
  if (include === undefined) return new Set(fallback);
  if (include.length === 0 || include.length > GRAPH_NODE_TYPE_VALUES.length) {
    return fail('include', GRAPH_VALIDATION.include);
  }
  const types = new Set<GraphNodeType>();
  for (const value of include) {
    if (!isType(value)) return fail('include', GRAPH_VALIDATION.include);
    types.add(value);
  }
  return types;
}

export function parseCursorOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = parseGraphCursor(cursor);
  if (offset === null) return fail('cursor', GRAPH_VALIDATION.cursor);
  return offset;
}

export function parseNodeRef(nodeId: string): { type: GraphNodeType; id: string } {
  const parsed = parseGraphNodeId(nodeId);
  if (!parsed) return fail('nodeId', GRAPH_VALIDATION.nodeId);
  return { type: parsed.type, id: parsed.entityId };
}

/** A list of at most `max` entries, each checked by `check`; `undefined` stays `undefined`. */
export function parseList(
  field: string,
  values: readonly string[] | undefined,
  max: number,
  check: (value: string) => boolean,
): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > max || !values.every(check)) return fail(field, GRAPH_VALIDATION.filter);
  return values;
}

export const isEntityId = (value: string): boolean => ENTITY_ID.test(value);

export function parseDate(field: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isValidDateOnly(value)) return fail(field, GRAPH_VALIDATION.date);
  return value;
}

export { fail as failGraphValidation };
