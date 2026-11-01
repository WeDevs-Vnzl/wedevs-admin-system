import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import { graphDepth } from '../../../domain';
import type { GraphReadPort, GraphRef } from '../../ports/graph-read.port';
import { parseEntityId, parseIncludeTypes, parseNodeType } from './graph-input';
import type { GraphResponse } from './graph-output';
import {
  ENTITY_GRAPH_DEFAULT_TYPES,
  GraphView,
  ResponseBuilder,
  graphAccess,
  requireRoot,
} from './graph-view';

export interface GetEntityGraphInput {
  readonly type: string;
  readonly id: string;
  /** 1 to 3, default 1. */
  readonly depth?: number;
  /** Node types to load, default every type except technologies and tags. */
  readonly include?: readonly string[];
  readonly includeArchived?: boolean;
}

/**
 * `GET /graph/{type}/{id}` (PRD §8.12.4, HU-24 CA1). The root and its relations to `depth`, at most
 * `GRAPH_EXPANSION_LIMIT` neighbours per node, the rest reported in `truncated`.
 */
export class GetEntityGraph {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly graph: GraphReadPort,
  ) {}

  async execute(actor: CurrentUser, input: GetEntityGraphInput): Promise<GraphResponse> {
    const root: GraphRef = {
      type: parseNodeType(input.type),
      id: parseEntityId(input.id),
    };
    const depth = graphDepth(input.depth);
    const include = parseIncludeTypes(input.include, ENTITY_GRAPH_DEFAULT_TYPES);

    const access = graphAccess(this.authorization, actor);
    const view = new GraphView(
      this.graph,
      access.scope,
      Boolean(input.includeArchived) && access.seesArchived,
    );
    await requireRoot(view, access, root);

    const builder = new ResponseBuilder(view);
    builder.addNode(root);
    let frontier: GraphRef[] = [root];
    for (let level = 0; level < depth && frontier.length > 0; level += 1) {
      frontier = await builder.addPages(frontier, include, 0);
    }
    return builder.build();
  }
}
