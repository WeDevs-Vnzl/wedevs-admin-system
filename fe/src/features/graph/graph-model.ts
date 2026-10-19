import { entityHref } from "@/lib/entity-routes";
import type { EntityType } from "@/lib/validators/enums";
import {
  GRAPH_NODE_TYPE_VALUES,
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
  type GraphResponse,
  type GraphTruncated,
} from "@/lib/validators/graph";

// Client-side model of an explored graph (PRD §8.12.4): what has been loaded, which expansion brought each node and
// edge (so "−" undoes exactly one "+"), and the filters applied without reloading (HU-24 CA4). Pure functions; the
// components keep the model in state.

/** Every type: the detail graph and its expansions load them all and filter on the client (HU-24 CA4). */
export const ENTITY_GRAPH_TYPES: GraphNodeType[] = [...GRAPH_NODE_TYPE_VALUES];

export interface GraphModel {
  rootId: string | null;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  /** "+N más" of each node whose neighbours were cut at `GRAPH_EXPANSION_LIMIT`, keyed by that node. */
  truncated: Map<string, GraphTruncated>;
  /** Nodes whose neighbours are loaded. */
  expanded: Set<string>;
  /** Node or edge id → the node whose expansion brought it (absent for the initial load). */
  addedBy: Map<string, string>;
}

export function modelFromResponse(response: GraphResponse, rootId: string | null): GraphModel {
  return {
    rootId,
    nodes: new Map(response.nodes.map((node) => [node.id, node])),
    edges: new Map(response.edges.map((edge) => [edge.id, edge])),
    truncated: new Map(response.truncated.map((item) => [item.nodeId, item])),
    expanded: new Set(rootId ? [rootId] : []),
    addedBy: new Map(),
  };
}

/** Merges the page `expandNode` returned for `parentId`; returns the ids of the nodes it added. */
export function mergeExpansion(
  model: GraphModel,
  parentId: string,
  response: GraphResponse,
): { model: GraphModel; added: string[] } {
  const nodes = new Map(model.nodes);
  const edges = new Map(model.edges);
  const addedBy = new Map(model.addedBy);
  const added: string[] = [];
  for (const node of response.nodes) {
    if (nodes.has(node.id)) continue;
    nodes.set(node.id, node);
    addedBy.set(node.id, parentId);
    added.push(node.id);
  }
  for (const edge of response.edges) {
    if (edges.has(edge.id)) continue;
    edges.set(edge.id, edge);
    addedBy.set(edge.id, parentId);
  }
  const truncated = new Map(model.truncated);
  const next = response.truncated.find((item) => item.nodeId === parentId);
  if (next) truncated.set(parentId, next);
  else truncated.delete(parentId);
  return {
    model: {
      ...model,
      nodes,
      edges,
      truncated,
      expanded: new Set(model.expanded).add(parentId),
      addedBy,
    },
    added,
  };
}

/** Undoes the expansion of `nodeId`, and of every node that expansion brought. The root never collapses away. */
export function collapseNode(model: GraphModel, nodeId: string): GraphModel {
  const owners = new Set([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, owner] of model.addedBy) {
      if (owners.has(owner) && model.nodes.has(id) && !owners.has(id) && id !== model.rootId) {
        owners.add(id);
        grew = true;
      }
    }
  }
  const removed = new Set([...owners].filter((id) => id !== nodeId));
  const nodes = new Map([...model.nodes].filter(([id]) => !removed.has(id)));
  const edges = new Map(
    [...model.edges].filter(
      ([id, edge]) =>
        !owners.has(model.addedBy.get(id) ?? "") &&
        nodes.has(edge.source) &&
        nodes.has(edge.target),
    ),
  );
  const addedBy = new Map([...model.addedBy].filter(([id]) => nodes.has(id) || edges.has(id)));
  const truncated = new Map([...model.truncated].filter(([id]) => !owners.has(id)));
  const expanded = new Set([...model.expanded].filter((id) => !owners.has(id)));
  return { ...model, nodes, edges, truncated, expanded, addedBy };
}

// ───────────────────────────── Filters ─────────────────────────────

export interface GraphFilterState {
  hiddenTypes: ReadonlySet<GraphNodeType>;
  /** `${type}:${status}`; a type with at least one entry shows only those statuses. */
  statuses: ReadonlySet<string>;
  /** Tag ids (entity graph: through the loaded `etiquetado` edges). */
  tagIds: ReadonlySet<string>;
  dateFrom: string;
  dateTo: string;
}

/** Types hidden by default in the detail graph (PRD §8.12.2: technologies and tags are opt-in). */
export const HIDDEN_BY_DEFAULT: readonly GraphNodeType[] = ["TECHNOLOGY", "TAG"];

export function emptyFilters(hiddenTypes: readonly GraphNodeType[] = []): GraphFilterState {
  return {
    hiddenTypes: new Set(hiddenTypes),
    statuses: new Set(),
    tagIds: new Set(),
    dateFrom: "",
    dateTo: "",
  };
}

const TAGGABLE: ReadonlySet<GraphNodeType> = new Set([
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "DOCUMENT",
  "NOTE",
]);

/** Main date of a node, from its card data (the date-range filter skips nodes without one). */
export function nodeDate(node: GraphNode): string | null {
  for (const key of ["date", "startDate", "dueDate"]) {
    const value = node.meta[key];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  }
  return null;
}

export interface VisibleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: GraphTruncated[];
}

/**
 * The nodes that pass the filters (the root always does), the edges between them, and the "+N más" of the visible
 * ones. With `focusId`, only that node and its direct neighbours remain (focus mode).
 */
export function visibleGraph(
  model: GraphModel,
  filters: GraphFilterState,
  focusId: string | null = null,
): VisibleGraph {
  const tagged = new Map<string, Set<string>>();
  for (const edge of model.edges.values()) {
    if (edge.relation !== "etiquetado") continue;
    const [node, tag] = edge.target.startsWith("TAG:")
      ? [edge.source, edge.target]
      : [edge.target, edge.source];
    tagged.set(node, (tagged.get(node) ?? new Set()).add(tag.slice(4)));
  }
  const statusTypes = new Set([...filters.statuses].map((key) => key.split(":")[0]));

  const passes = (node: GraphNode): boolean => {
    if (node.id === model.rootId) return true;
    if (filters.hiddenTypes.has(node.type)) return false;
    if (node.status && statusTypes.has(node.type)) {
      if (!filters.statuses.has(`${node.type}:${node.status}`)) return false;
    }
    if (filters.tagIds.size) {
      if (node.type === "TAG" && !filters.tagIds.has(node.entityId)) return false;
      if (TAGGABLE.has(node.type)) {
        const tags = tagged.get(node.id);
        if (![...filters.tagIds].some((id) => tags?.has(id))) return false;
      }
    }
    const date = nodeDate(node);
    if (date !== null) {
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
    }
    return true;
  };

  let ids = new Set([...model.nodes.values()].filter(passes).map((node) => node.id));
  if (focusId && ids.has(focusId)) {
    const neighbourhood = new Set([focusId]);
    for (const edge of model.edges.values()) {
      if (edge.source === focusId && ids.has(edge.target)) neighbourhood.add(edge.target);
      if (edge.target === focusId && ids.has(edge.source)) neighbourhood.add(edge.source);
    }
    ids = neighbourhood;
  }
  return {
    nodes: [...model.nodes.values()].filter((node) => ids.has(node.id)),
    edges: [...model.edges.values()].filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    truncated: [...model.truncated.values()].filter((item) => ids.has(item.nodeId)),
  };
}

/** Loaded nodes per type, for the counters of the type filter. */
export function typeCounts(nodes: Iterable<GraphNode>): Partial<Record<GraphNodeType, number>> {
  const counts: Partial<Record<GraphNodeType, number>> = {};
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
  return counts;
}

// ───────────────────────────── Search, stats, routes ─────────────────────────────

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Nodes whose label or code contains the query, accent-insensitive; exact matches first. */
export function searchNodes(nodes: readonly GraphNode[], query: string): GraphNode[] {
  const needle = fold(query);
  if (!needle) return [];
  const score = (node: GraphNode) => {
    const label = fold(node.label);
    const code = fold(node.code ?? "");
    if (label === needle || code === needle) return 0;
    if (label.startsWith(needle) || code.startsWith(needle)) return 1;
    if (label.includes(needle) || code.includes(needle)) return 2;
    return 3;
  };
  return nodes
    .map((node) => ({ node, rank: score(node) }))
    .filter((item) => item.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.node.label.localeCompare(b.node.label))
    .map((item) => item.node);
}

/** The `limit` nodes with the most visible relations. */
export function mostConnected(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  limit = 5,
): { node: GraphNode; count: number }[] {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return nodes
    .map((node) => ({ node, count: counts.get(node.id) ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.node.label.localeCompare(b.node.label))
    .slice(0, limit);
}

/** Types with a `/<entity>/[id]/graph` route (PRD §11). */
export const GRAPH_ROUTE_TYPES: ReadonlySet<GraphNodeType> = new Set([
  "CLIENT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "DOCUMENT",
]);

/**
 * Detail page of a node. Contacts live inside their client (`?tab=contacts`, found through the loaded edges);
 * technologies and tags open their settings catalogue.
 */
export function nodeDetailHref(node: GraphNode, edges: Iterable<GraphEdge> = []): string | null {
  switch (node.type) {
    case "CONTACT": {
      for (const edge of edges) {
        const other =
          edge.target === node.id ? edge.source : edge.source === node.id ? edge.target : null;
        if (other?.startsWith("CLIENT:")) {
          return `/clients/${encodeURIComponent(other.slice(7))}?tab=contacts`;
        }
      }
      return null;
    }
    case "TECHNOLOGY":
      return "/settings/technologies";
    case "TAG":
      return "/settings/tags";
    default:
      return entityHref({ type: node.type as EntityType, id: node.entityId });
  }
}

export function nodeGraphHref(node: GraphNode): string | null {
  if (!GRAPH_ROUTE_TYPES.has(node.type)) return null;
  const href = entityHref({ type: node.type as EntityType, id: node.entityId });
  return href ? `${href}/graph` : null;
}
