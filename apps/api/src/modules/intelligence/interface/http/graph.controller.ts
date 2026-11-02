import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { ExpandNode } from '../../application/use-cases/graph/expand-node.use-case';
import { GetEntityGraph } from '../../application/use-cases/graph/get-entity-graph.use-case';
import { GetGlobalGraph } from '../../application/use-cases/graph/get-global-graph.use-case';
import {
  EntityGraphQueryDto,
  GlobalGraphQueryDto,
  GlobalGraphResponseDto,
  GraphResponseDto,
  NodeNeighboursQueryDto,
} from './graph.dto';

const toArray = (value: string | readonly string[] | undefined): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? [...value] : [value as string];
const toFlag = (value: 'true' | 'false' | undefined): boolean | undefined =>
  value === undefined ? undefined : value === 'true';

/**
 * Relationship graph (PRD §8.12, HU-24, HU-25). `@Authenticated()` at the route: the grant depends on the
 * type of each node, so the use cases run `can(read)` per type and per node (C13).
 */
@ApiTags('graph')
@Controller('graph')
@Authenticated()
export class GraphController {
  constructor(
    private readonly getGlobalGraph: GetGlobalGraph,
    private readonly getEntityGraph: GetEntityGraph,
    private readonly expandNode: ExpandNode,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'getGlobalGraph',
    summary: 'Global graph (clients, projects and documents by default) with its statistics',
  })
  @ApiOkResponse({ type: GlobalGraphResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async global(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: GlobalGraphQueryDto,
  ): Promise<GlobalGraphResponseDto> {
    const include = toArray(query.include);
    const statuses = toArray(query.statuses);
    const tagIds = toArray(query.tagIds);
    const technologyIds = toArray(query.technologyIds);
    const clientIds = toArray(query.clientIds);
    const onlyActive = toFlag(query.onlyActive);
    const includeArchived = toFlag(query.includeArchived);
    return this.getGlobalGraph.execute(user, {
      ...(include ? { include } : {}),
      filters: {
        ...(statuses ? { statuses } : {}),
        ...(tagIds ? { tagIds } : {}),
        ...(technologyIds ? { technologyIds } : {}),
        ...(clientIds ? { clientIds } : {}),
        ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
        ...(query.dateTo ? { dateTo: query.dateTo } : {}),
        ...(onlyActive !== undefined ? { onlyActive } : {}),
        ...(includeArchived !== undefined ? { includeArchived } : {}),
      },
    });
  }

  @Get('nodes/:nodeId/neighbours')
  @ApiOperation({
    operationId: 'expandGraphNode',
    summary: 'One page (at most 50) of the neighbours of a node; `cursor` loads the next page',
  })
  @ApiOkResponse({ type: GraphResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async neighbours(
    @CurrentUser() user: CurrentUserModel,
    @Param('nodeId') nodeId: string,
    @Query() query: NodeNeighboursQueryDto,
  ): Promise<GraphResponseDto> {
    const include = toArray(query.include);
    const includeArchived = toFlag(query.includeArchived);
    return this.expandNode.execute(user, {
      nodeId,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(include ? { include } : {}),
      ...(includeArchived !== undefined ? { includeArchived } : {}),
    });
  }

  @Get(':type/:id')
  @ApiOperation({
    operationId: 'getEntityGraph',
    summary: 'A record and its relations to the requested depth (1 by default, at most 3)',
  })
  @ApiOkResponse({ type: GraphResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async entity(
    @CurrentUser() user: CurrentUserModel,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query() query: EntityGraphQueryDto,
  ): Promise<GraphResponseDto> {
    const include = toArray(query.include);
    const includeArchived = toFlag(query.includeArchived);
    return this.getEntityGraph.execute(user, {
      type,
      id,
      ...(query.depth !== undefined ? { depth: query.depth } : {}),
      ...(include ? { include } : {}),
      ...(includeArchived !== undefined ? { includeArchived } : {}),
    });
  }
}
