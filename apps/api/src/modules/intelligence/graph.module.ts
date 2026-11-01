import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import { AUTHORIZATION } from '../../shared/application/ports/tokens';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { GRAPH_READ, type GraphReadPort } from './application/ports/graph-read.port';
import { ExpandNode } from './application/use-cases/graph/expand-node.use-case';
import { GetEntityGraph } from './application/use-cases/graph/get-entity-graph.use-case';
import { GetGlobalGraph } from './application/use-cases/graph/get-global-graph.use-case';
import { PrismaGraphRead } from './infrastructure/prisma-graph-read.adapter';
import { GraphController } from './interface/http/graph.controller';

/** Relationship graph (PRD §8.12): the read side of every record type, per-node visibility in the use cases. */
@Module({
  imports: [SharedInterfaceModule],
  controllers: [GraphController],
  providers: [
    { provide: GRAPH_READ, useClass: PrismaGraphRead },
    {
      provide: GetEntityGraph,
      useFactory: (authorization: AuthorizationPort, graph: GraphReadPort) =>
        new GetEntityGraph(authorization, graph),
      inject: [AUTHORIZATION, GRAPH_READ],
    },
    {
      provide: ExpandNode,
      useFactory: (authorization: AuthorizationPort, graph: GraphReadPort) =>
        new ExpandNode(authorization, graph),
      inject: [AUTHORIZATION, GRAPH_READ],
    },
    {
      provide: GetGlobalGraph,
      useFactory: (authorization: AuthorizationPort, graph: GraphReadPort) =>
        new GetGlobalGraph(authorization, graph),
      inject: [AUTHORIZATION, GRAPH_READ],
    },
  ],
})
export class GraphModule {}
