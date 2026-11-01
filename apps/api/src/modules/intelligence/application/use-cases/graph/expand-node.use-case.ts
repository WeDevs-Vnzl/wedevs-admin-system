import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import type { GraphReadPort } from '../../ports/graph-read.port';
import { parseCursorOffset, parseIncludeTypes, parseNodeRef } from './graph-input';
import type { GraphResponse } from './graph-output';
import {
  ENTITY_GRAPH_DEFAULT_TYPES,
  GraphView,
  ResponseBuilder,
  graphAccess,
  requireRoot,
} from './graph-view';

export interface ExpandNodeInput {
  /** `${type}:${entityId}` */
  readonly nodeId: string;
  readonly include?: readonly string[];
  /** Decimal offset of the next neighbour, from `truncated[].cursor`. */
  readonly cursor?: string;
  readonly includeArchived?: boolean;
}

/** `GET /graph/nodes/{nodeId}/neighbours` (PRD §8.12.4): one page of the neighbours of one node. */
export class ExpandNode {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly graph: GraphReadPort,
  ) {}

  async execute(actor: CurrentUser, input: ExpandNodeInput): Promise<GraphResponse> {
    const root = parseNodeRef(input.nodeId);
    const offset = parseCursorOffset(input.cursor);
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
    await builder.addPages([root], include, offset);
    return builder.build();
  }
}
