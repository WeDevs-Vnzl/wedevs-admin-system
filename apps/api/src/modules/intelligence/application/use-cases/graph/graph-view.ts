import type { PermissionResource } from '../../../../../shared/application/authorization';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { GRAPH_EXPANSION_LIMIT, GRAPH_NODE_TYPE_VALUES } from '../../ports/graph-read.port';
import { buildGraphCursor, graphNodeId } from '../../../domain';
import type {
  GraphNodeFacts,
  GraphNodeType,
  GraphPresence,
  GraphReadPort,
  GraphReadScope,
  GraphRef,
  GraphRelationRow,
} from '../../ports/graph-read.port';
import type {
  GraphEdgeOutput,
  GraphNodeOutput,
  GraphResponse,
  GraphTruncatedOutput,
} from './graph-output';

/**
 * The resource a node type needs `read` on; technologies and tags are catalog chips any signed-in user
 * sees (DT-71). The single visibility map of the graph (C13).
 */
export const GRAPH_RESOURCE: Record<GraphNodeType, PermissionResource | null> = {
  CLIENT: 'client',
  CONTACT: 'contact',
  PROJECT: 'project',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  EXPENSE: 'expense',
  ACCOUNT: 'account',
  DOCUMENT: 'document',
  NOTE: 'note',
  TECHNOLOGY: null,
  TAG: null,
};

/** The detail graph loads every type except technologies and tags (hidden by default, §8.12.2). */
export const ENTITY_GRAPH_DEFAULT_TYPES: readonly GraphNodeType[] = GRAPH_NODE_TYPE_VALUES.filter(
  (type) => type !== 'TECHNOLOGY' && type !== 'TAG',
);

const TYPE_ORDER = new Map<GraphNodeType, number>(
  GRAPH_NODE_TYPE_VALUES.map((type, index) => [type, index]),
);

export const nodeIdOf = (ref: GraphRef): string => graphNodeId(ref.type, ref.id);

export interface GraphAccess {
  readonly scope: GraphReadScope;
  /** `restore` on `trash`: archived records are visible only with it (C19). */
  readonly seesArchived: boolean;
}

/** What the caller may see, resolved once per call from `can()` and `canSeeFinancials` (C13). */
export function graphAccess(authorization: AuthorizationPort, actor: CurrentUser): GraphAccess {
  const types = new Set<GraphNodeType>(
    GRAPH_NODE_TYPE_VALUES.filter((type) => {
      const resource = GRAPH_RESOURCE[type];
      return resource === null || authorization.can(actor, 'read', resource);
    }),
  );
  return {
    scope: { types, financials: authorization.canSeeFinancials(actor) },
    seesArchived: authorization.can(actor, 'restore', 'trash'),
  };
}

function dedupe(rows: readonly GraphRelationRow[]): GraphRelationRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = nodeIdOf(row.other);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(refs: readonly GraphRef[]): GraphRef[] {
  const seen = new Map<string, GraphRef>();
  for (const ref of refs) seen.set(nodeIdOf(ref), ref);
  return [...seen.values()];
}

/**
 * The store as one caller sees it during one call. Loads are batched through the port (a number of calls
 * that depends on the number of node types, never on the number of nodes) and cached; the sync accessors
 * require a prior load.
 */
export class GraphView {
  private readonly facts = new Map<string, GraphNodeFacts>();
  private readonly presence = new Map<string, GraphPresence>();
  private readonly absent = new Set<string>();
  private readonly relationRows = new Map<string, readonly GraphRelationRow[]>();

  constructor(
    private readonly port: GraphReadPort,
    readonly scope: GraphReadScope,
    /** Whether archived neighbours are shown (the toggle, already checked against the grant). */
    readonly showArchived: boolean,
  ) {}

  readable(type: GraphNodeType): boolean {
    return this.scope.types.has(type);
  }

  seed(refs: readonly { ref: GraphRef; facts: GraphNodeFacts }[]): void {
    for (const { ref, facts } of refs) this.facts.set(nodeIdOf(ref), facts);
  }

  async loadFacts(refs: readonly GraphRef[]): Promise<void> {
    const missing = unique(refs).filter(
      (ref) =>
        this.readable(ref.type) &&
        !this.facts.has(nodeIdOf(ref)) &&
        !this.absent.has(nodeIdOf(ref)),
    );
    if (missing.length === 0) return;
    const found = await this.port.facts(missing, this.scope);
    for (const ref of missing) {
      const key = nodeIdOf(ref);
      const facts = found.get(key);
      if (facts) this.facts.set(key, facts);
      else this.absent.add(key);
    }
  }

  async loadPresence(refs: readonly GraphRef[]): Promise<void> {
    const missing = unique(refs).filter((ref) => {
      const key = nodeIdOf(ref);
      return (
        this.readable(ref.type) &&
        !this.facts.has(key) &&
        !this.presence.has(key) &&
        !this.absent.has(key)
      );
    });
    if (missing.length === 0) return;
    const found = await this.port.presence(missing, this.scope);
    for (const ref of missing) {
      const key = nodeIdOf(ref);
      const presence = found.get(key);
      if (presence) this.presence.set(key, presence);
      else this.absent.add(key);
    }
  }

  async loadRelations(refs: readonly GraphRef[]): Promise<void> {
    const missing = unique(refs).filter((ref) => !this.relationRows.has(nodeIdOf(ref)));
    if (missing.length === 0) return;
    const found = await this.port.relations(missing, this.scope);
    for (const ref of missing) {
      const key = nodeIdOf(ref);
      this.relationRows.set(key, dedupe(found.get(key) ?? []));
    }
  }

  /** Stored relations of `ref`, towards readable types. Requires `loadRelations`. */
  relations(ref: GraphRef): readonly GraphRelationRow[] {
    return this.relationRows.get(nodeIdOf(ref)) ?? [];
  }

  /** The other ends of the given nodes' relations. Requires `loadRelations`. */
  othersOf(refs: readonly GraphRef[]): GraphRef[] {
    return unique(refs.flatMap((ref) => this.relations(ref).map((row) => row.other)));
  }

  factsOf(ref: GraphRef): GraphNodeFacts | null {
    return this.facts.get(nodeIdOf(ref)) ?? null;
  }

  /** Whether `ref` is a node the caller may see as a neighbour. Requires `loadFacts` or `loadPresence`. */
  visible(ref: GraphRef): boolean {
    if (!this.readable(ref.type)) return false;
    const key = nodeIdOf(ref);
    const known = this.facts.get(key) ?? this.presence.get(key);
    if (!known) return false;
    return !known.archived || this.showArchived;
  }

  /** Visible relations of `ref` towards `include` types, ordered by type, label and id. Needs the facts of those. */
  candidates(ref: GraphRef, include: ReadonlySet<GraphNodeType>): GraphRelationRow[] {
    return this.relations(ref)
      .filter((row) => include.has(row.other.type) && this.visible(row.other))
      .sort((a, b) => {
        const byType = (TYPE_ORDER.get(a.other.type) ?? 0) - (TYPE_ORDER.get(b.other.type) ?? 0);
        if (byType !== 0) return byType;
        const byLabel = (this.factsOf(a.other)?.label ?? '').localeCompare(
          this.factsOf(b.other)?.label ?? '',
          'es',
        );
        return byLabel !== 0 ? byLabel : a.other.id.localeCompare(b.other.id);
      });
  }

  degree(ref: GraphRef): number {
    return this.relations(ref).filter((row) => this.visible(row.other)).length;
  }

  /** Loads what `degree` needs for the given nodes: their relations and the presence of the other ends. */
  async prepareDegrees(refs: readonly GraphRef[]): Promise<void> {
    await this.loadRelations(refs);
    await this.loadPresence(this.othersOf(refs));
  }

  node(ref: GraphRef): GraphNodeOutput {
    const facts = this.factsOf(ref);
    if (!facts) throw new NotFoundError();
    return {
      id: nodeIdOf(ref),
      type: ref.type,
      entityId: ref.id,
      label: facts.label,
      ...(facts.code !== undefined ? { code: facts.code } : {}),
      ...(facts.status !== undefined ? { status: facts.status } : {}),
      meta: facts.meta,
      archived: facts.archived,
      degree: this.degree(ref),
    };
  }
}

export function edgeOf(ref: GraphRef, row: GraphRelationRow): GraphEdgeOutput {
  const self = nodeIdOf(ref);
  const other = nodeIdOf(row.other);
  const [source, target] = row.outgoing ? [self, other] : [other, self];
  return {
    id: `${source}|${row.relation}|${target}`,
    source,
    target,
    relation: row.relation,
    ...(row.label ? { label: row.label } : {}),
  };
}

/** Accumulates nodes (in order), edges and truncations, and builds the response once degrees are loaded. */
export class ResponseBuilder {
  private readonly refs = new Map<string, GraphRef>();
  private readonly edges = new Map<string, GraphEdgeOutput>();
  private readonly truncated: GraphTruncatedOutput[] = [];

  constructor(private readonly view: GraphView) {}

  has(ref: GraphRef): boolean {
    return this.refs.has(nodeIdOf(ref));
  }

  addNode(ref: GraphRef): void {
    if (!this.has(ref)) this.refs.set(nodeIdOf(ref), ref);
  }

  addEdge(edge: GraphEdgeOutput): void {
    this.edges.set(edge.id, edge);
  }

  nodeRefs(): GraphRef[] {
    return [...this.refs.values()];
  }

  /**
   * Adds one page of the neighbours of every `frontier` node (filtered by `include`) and returns the
   * neighbours that were not in the response yet. Requires the relations of the frontier.
   */
  async addPages(
    frontier: readonly GraphRef[],
    include: ReadonlySet<GraphNodeType>,
    offset: number,
  ): Promise<GraphRef[]> {
    await this.view.loadRelations(frontier);
    const others = this.view.othersOf(frontier);
    await this.view.loadFacts(others.filter((ref) => include.has(ref.type)));
    await this.view.loadPresence(others.filter((ref) => !include.has(ref.type)));
    const added: GraphRef[] = [];
    for (const ref of frontier) {
      const all = this.view.candidates(ref, include);
      const page = all.slice(offset, offset + GRAPH_EXPANSION_LIMIT);
      for (const row of page) {
        if (!this.has(row.other)) added.push(row.other);
        this.addNode(row.other);
        this.addEdge(edgeOf(ref, row));
      }
      const remaining = all.length - offset - page.length;
      if (remaining > 0) {
        this.truncated.push({
          nodeId: nodeIdOf(ref),
          remaining,
          cursor: buildGraphCursor(offset + page.length),
        });
      }
    }
    return added;
  }

  async build(): Promise<GraphResponse> {
    const refs = this.nodeRefs();
    await this.view.prepareDegrees(refs);
    return {
      nodes: refs.map((ref) => this.view.node(ref)),
      edges: [...this.edges.values()],
      truncated: this.truncated,
    };
  }
}

/**
 * The root of a detail graph or of an expansion: a readable type (else `FORBIDDEN`, whether or not the
 * row exists), an existing row, archived only with the trash grant (else `NOT_FOUND`, C14).
 */
export async function requireRoot(
  view: GraphView,
  access: GraphAccess,
  root: GraphRef,
): Promise<void> {
  if (!view.readable(root.type)) throw new ForbiddenError();
  await view.loadFacts([root]);
  const facts = view.factsOf(root);
  if (!facts || (facts.archived && !access.seesArchived)) throw new NotFoundError();
}
