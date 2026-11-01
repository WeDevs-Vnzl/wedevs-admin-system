import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import { SearchReindexRegistry } from '../../shared/application/ports/search-reindex.port';
import { AUTHORIZATION, SEARCH_INDEX, UNIT_OF_WORK } from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import {
  SEARCH_INDEX_MAINTENANCE,
  SEARCH_READ,
  type SearchIndexMaintenancePort,
  type SearchReadPort,
} from './application/ports/search-read.port';
import { ReindexAll } from './application/use-cases/search/reindex-all.use-case';
import { ReindexEntity } from './application/use-cases/search/reindex-entity.use-case';
import { SearchGlobal } from './application/use-cases/search/search-global.use-case';
import { PrismaSearchRead } from './infrastructure/prisma-search-read';
import { PrismaSearchIndexMaintenance } from './infrastructure/prisma-search-read-maintenance';
import { SearchController } from './interface/http/search.controller';

/**
 * Global search (PRD §7.6, HU-26) and the repair of the index (`ReindexEntity`, `ReindexAll`, DT-167). The
 * reindex use cases have no route and no job: `scripts/reindex-all.ts` and, later, the rename flows call
 * them. Contexts register their sources in `SearchReindexRegistry` from their own `onModuleInit`. Not
 * imported by `AppModule` before package 6.1.
 */
@Module({
  controllers: [SearchController],
  providers: [
    { provide: SEARCH_READ, useClass: PrismaSearchRead },
    { provide: SEARCH_INDEX_MAINTENANCE, useClass: PrismaSearchIndexMaintenance },
    {
      provide: SearchGlobal,
      useFactory: (authorization: AuthorizationPort, search: SearchReadPort) =>
        new SearchGlobal(authorization, search),
      inject: [AUTHORIZATION, SEARCH_READ],
    },
    {
      provide: ReindexEntity,
      useFactory: (
        uow: UnitOfWorkPort,
        registry: SearchReindexRegistry,
        index: SearchIndexPort,
        maintenance: SearchIndexMaintenancePort,
      ) => new ReindexEntity(uow, registry, index, maintenance),
      inject: [UNIT_OF_WORK, SearchReindexRegistry, SEARCH_INDEX, SEARCH_INDEX_MAINTENANCE],
    },
    {
      provide: ReindexAll,
      useFactory: (
        uow: UnitOfWorkPort,
        registry: SearchReindexRegistry,
        index: SearchIndexPort,
        maintenance: SearchIndexMaintenancePort,
      ) => new ReindexAll(uow, registry, index, maintenance),
      inject: [UNIT_OF_WORK, SearchReindexRegistry, SEARCH_INDEX, SEARCH_INDEX_MAINTENANCE],
    },
  ],
  exports: [SearchGlobal, ReindexEntity, ReindexAll],
})
export class SearchModule {}
