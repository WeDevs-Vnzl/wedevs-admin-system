import {
  GLOBAL_GRAPH_DEFAULT_TYPES,
  GRAPH_CURSOR_MAX_LENGTH,
  GRAPH_EXPANSION_LIMIT,
  GRAPH_MAX_DEPTH,
  GRAPH_NODE_TYPE_VALUES,
  type GraphNodeType,
  type GraphRelationKey,
} from '../../domain';

// The interface layer may not import the domain, so the wire vocabulary is re-exported from here.
export {
  GLOBAL_GRAPH_DEFAULT_TYPES,
  GRAPH_CURSOR_MAX_LENGTH,
  GRAPH_EXPANSION_LIMIT,
  GRAPH_MAX_DEPTH,
  GRAPH_NODE_TYPE_VALUES,
};
export type { GraphNodeType, GraphRelationKey };

export const GRAPH_READ = Symbol('GRAPH_READ');

/** One record of the graph. */
export interface GraphRef {
  readonly type: GraphNodeType;
  readonly id: string;
}

/** Card and hover-card data. Money is a decimal string (C15); never a file key, token or hash. */
export type GraphMeta = Readonly<Record<string, string | number | null>>;

/** What the node card and the global filters need from a stored row. */
export interface GraphNodeFacts {
  readonly label: string;
  readonly code?: string;
  readonly status?: string;
  readonly meta: GraphMeta;
  readonly archived: boolean;
  /** Main date (Caracas business day) for the date-range filter; `null` when the type has none. */
  readonly date: string | null;
  /** Tags of the record; only loaded by `listFacts`. `null`: the type carries no tags. */
  readonly tagIds?: readonly string[] | null;
  /** Technologies of a project; only loaded by `listFacts`. */
  readonly technologyIds?: readonly string[] | null;
}

/** Existence and trash state of a record, without its card. */
export interface GraphPresence {
  readonly archived: boolean;
}

/** One relation seen from a node: the other end, and whether this node is the edge source. */
export interface GraphRelationRow {
  readonly other: GraphRef;
  readonly relation: GraphRelationKey;
  readonly label?: string;
  readonly outgoing: boolean;
}

/** What the caller may read. The adapter never queries a type outside `types` (defence in depth, C13). */
export interface GraphReadScope {
  readonly types: ReadonlySet<GraphNodeType>;
  /** Owner and Admin: money in `meta` is filled in, else it is `null` (C13). */
  readonly financials: boolean;
}

export interface GraphReadPort {
  /** Cards of the given records, archived ones included. Records that do not exist are absent. Keys are node ids. */
  facts(refs: readonly GraphRef[], scope: GraphReadScope): Promise<Map<string, GraphNodeFacts>>;
  /** Existence and archived state of the given records. Keys are node ids. */
  presence(refs: readonly GraphRef[], scope: GraphReadScope): Promise<Map<string, GraphPresence>>;
  /**
   * Every stored relation of the given records towards records of `scope.types`, unfiltered by
   * visibility. Keyed by the node id of the record asked for; records without relations are absent.
   */
  relations(
    refs: readonly GraphRef[],
    scope: GraphReadScope,
  ): Promise<Map<string, GraphRelationRow[]>>;
  /** Every record of one type with its card, tags and technologies, ordered by id. */
  listFacts(
    type: GraphNodeType,
    scope: GraphReadScope,
    options: { readonly includeArchived: boolean },
  ): Promise<{ readonly ref: GraphRef; readonly facts: GraphNodeFacts }[]>;
}
