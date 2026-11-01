import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import {
  GLOBAL_GRAPH_DEFAULT_TYPES,
  GRAPH_NODE_TYPE_VALUES,
  type GraphNodeFacts,
  type GraphNodeType,
  type GraphReadPort,
  type GraphRef,
} from '../../ports/graph-read.port';
import {
  GRAPH_VALIDATION,
  failGraphValidation,
  isEntityId,
  parseDate,
  parseIncludeTypes,
  parseList,
} from './graph-input';
import type { GlobalGraphResponse, GraphConnectedOutput } from './graph-output';
import { GraphView, ResponseBuilder, edgeOf, graphAccess } from './graph-view';

export interface GlobalGraphFiltersInput {
  /** Raw statuses of the nodes' own modules. */
  readonly statuses?: readonly string[];
  readonly tagIds?: readonly string[];
  readonly technologyIds?: readonly string[];
  readonly clientIds?: readonly string[];
  /** Range over the nodes' main date (`YYYY-MM-DD`). */
  readonly dateFrom?: string;
  readonly dateTo?: string;
  /** Hides inactive clients, finished projects and archived nodes. */
  readonly onlyActive?: boolean;
  readonly includeArchived?: boolean;
}

export interface GetGlobalGraphInput {
  /** Defaults to clients, projects and documents. */
  readonly include?: readonly string[];
  readonly filters?: GlobalGraphFiltersInput;
}

const MOST_CONNECTED = 10;
const FINISHED_PROJECT_STATUSES: ReadonlySet<string> = new Set(['ENTREGADO', 'CANCELADO']);
const MAX_STATUSES = 40;
const MAX_STATUS_LENGTH = 40;
const MAX_TAGS = 50;
const MAX_TECHNOLOGIES = 60;
const MAX_CLIENTS = 50;
/** Types whose clients come from their own relations; expenses, documents and notes hop once more. */
const DIRECT_CLIENT_TYPES: ReadonlySet<GraphNodeType> = new Set([
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
]);
const HOPPING_TYPES: ReadonlySet<GraphNodeType> = new Set(['EXPENSE', 'DOCUMENT', 'NOTE']);

interface Candidate {
  readonly ref: GraphRef;
  readonly facts: GraphNodeFacts;
}

interface Filters {
  readonly statuses: readonly string[] | undefined;
  readonly tagIds: readonly string[] | undefined;
  readonly technologyIds: readonly string[] | undefined;
  readonly clientIds: readonly string[] | undefined;
  readonly dateFrom: string | undefined;
  readonly dateTo: string | undefined;
  readonly onlyActive: boolean;
}

function parseFilters(input: GlobalGraphFiltersInput): Filters {
  const dateFrom = parseDate('filters.dateFrom', input.dateFrom);
  const dateTo = parseDate('filters.dateTo', input.dateTo);
  if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
    return failGraphValidation('filters.dateTo', GRAPH_VALIDATION.dateRange);
  }
  return {
    statuses: parseList(
      'filters.statuses',
      input.statuses,
      MAX_STATUSES,
      (value) => value.length >= 1 && value.length <= MAX_STATUS_LENGTH,
    ),
    tagIds: parseList('filters.tagIds', input.tagIds, MAX_TAGS, isEntityId),
    technologyIds: parseList(
      'filters.technologyIds',
      input.technologyIds,
      MAX_TECHNOLOGIES,
      isEntityId,
    ),
    clientIds: parseList('filters.clientIds', input.clientIds, MAX_CLIENTS, isEntityId),
    dateFrom,
    dateTo,
    onlyActive: input.onlyActive === true,
  };
}

/** The clients a node belongs to; `null` when the type is not client-scoped (accounts, catalogs). */
function clientScope(view: GraphView, ref: GraphRef, depth = 0): Set<string> | null {
  switch (ref.type) {
    case 'CLIENT':
      return new Set([ref.id]);
    case 'CONTACT':
    case 'PROJECT':
    case 'INVOICE':
    case 'PAYMENT':
      return new Set(
        view
          .relations(ref)
          .filter((row) => row.other.type === 'CLIENT')
          .map((row) => row.other.id),
      );
    case 'EXPENSE':
    case 'DOCUMENT':
    case 'NOTE': {
      const scope = new Set<string>();
      if (depth > 1) return scope;
      for (const row of view.relations(ref)) {
        if (row.other.type === 'TAG' || row.other.type === 'ACCOUNT') continue;
        if (ref.type === 'DOCUMENT' && row.relation === 'anotado_en') continue;
        for (const id of clientScope(view, row.other, depth + 1) ?? []) scope.add(id);
      }
      return scope;
    }
    case 'ACCOUNT':
    case 'TECHNOLOGY':
    case 'TAG':
      return null;
  }
}

/** Whether a candidate passes the filters (a filter skips the types it does not apply to). */
function passes(view: GraphView, candidate: Candidate, filters: Filters): boolean {
  const { ref, facts } = candidate;
  if (filters.onlyActive) {
    if (facts.archived) return false;
    if (ref.type === 'CLIENT' && facts.status === 'INACTIVO') return false;
    if (ref.type === 'PROJECT' && FINISHED_PROJECT_STATUSES.has(facts.status ?? '')) return false;
  }
  if (
    filters.statuses?.length &&
    facts.status !== undefined &&
    !filters.statuses.includes(facts.status)
  ) {
    return false;
  }
  if (filters.tagIds?.length) {
    const wanted = filters.tagIds;
    if (ref.type === 'TAG' && !wanted.includes(ref.id)) return false;
    if (facts.tagIds != null && !facts.tagIds.some((id) => wanted.includes(id))) return false;
  }
  if (filters.technologyIds?.length) {
    const wanted = filters.technologyIds;
    if (ref.type === 'TECHNOLOGY' && !wanted.includes(ref.id)) return false;
    if (ref.type === 'PROJECT' && !(facts.technologyIds ?? []).some((id) => wanted.includes(id))) {
      return false;
    }
  }
  if (filters.clientIds?.length) {
    const scope = clientScope(view, ref);
    if (scope !== null && !filters.clientIds.some((id) => scope.has(id))) return false;
  }
  if (facts.date !== null) {
    if (filters.dateFrom && facts.date < filters.dateFrom) return false;
    if (filters.dateTo && facts.date > filters.dateTo) return false;
  }
  return true;
}

/**
 * `GET /graph` (PRD §8.12.4, HU-25 CA1): every record of the included types that passes the filters, the
 * edges among them, and the statistics of the graph. Types the caller cannot read are dropped silently.
 */
export class GetGlobalGraph {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly graph: GraphReadPort,
  ) {}

  async execute(actor: CurrentUser, input: GetGlobalGraphInput): Promise<GlobalGraphResponse> {
    const include = parseIncludeTypes(input.include, GLOBAL_GRAPH_DEFAULT_TYPES);
    const filters = parseFilters(input.filters ?? {});

    const access = graphAccess(this.authorization, actor);
    const showArchived =
      input.filters?.includeArchived === true && !filters.onlyActive && access.seesArchived;
    const view = new GraphView(this.graph, access.scope, showArchived);

    const lists = await Promise.all(
      GRAPH_NODE_TYPE_VALUES.filter((type) => include.has(type) && view.readable(type)).map(
        (type) => this.graph.listFacts(type, access.scope, { includeArchived: showArchived }),
      ),
    );
    const candidates: Candidate[] = lists.flat();
    view.seed(candidates);

    if (filters.clientIds?.length) await this.loadClientScopes(view, candidates);
    const kept = candidates.filter((candidate) => passes(view, candidate, filters));

    const builder = new ResponseBuilder(view);
    const refs = kept.map((candidate) => candidate.ref);
    for (const ref of refs) builder.addNode(ref);
    await view.loadRelations(refs);
    for (const ref of refs) {
      for (const row of view.relations(ref)) {
        if (builder.has(row.other)) builder.addEdge(edgeOf(ref, row));
      }
    }
    const response = await builder.build();
    return { ...response, stats: statsOf(response.nodes, response.edges.length) };
  }

  /** Loads the relations `clientScope` reads: the candidates' own and, for expenses, documents and notes, one hop more. */
  private async loadClientScopes(view: GraphView, candidates: readonly Candidate[]): Promise<void> {
    const direct = candidates
      .map((candidate) => candidate.ref)
      .filter((ref) => DIRECT_CLIENT_TYPES.has(ref.type) || HOPPING_TYPES.has(ref.type));
    await view.loadRelations(direct);
    const hop = direct
      .filter((ref) => HOPPING_TYPES.has(ref.type))
      .flatMap((ref) => view.relations(ref).map((row) => row.other))
      .filter((other) => other.type !== 'TAG' && other.type !== 'ACCOUNT');
    await view.loadRelations(hop);
  }
}

function statsOf(
  nodes: readonly { id: string; type: GraphNodeType; label: string; degree: number }[],
  edgeCount: number,
) {
  const mostConnected: GraphConnectedOutput[] = [...nodes]
    .sort(
      (a, b) =>
        b.degree - a.degree || a.label.localeCompare(b.label, 'es') || a.id.localeCompare(b.id),
    )
    .slice(0, MOST_CONNECTED)
    .map((item) => ({ nodeId: item.id, type: item.type, label: item.label, degree: item.degree }));
  return { nodeCount: nodes.length, edgeCount, mostConnected };
}
