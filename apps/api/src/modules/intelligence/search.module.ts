import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import { AUTHORIZATION } from '../../shared/application/ports/tokens';
import { SEARCH_READ, type SearchReadPort } from './application/ports/search-read.port';
import { SearchGlobal } from './application/use-cases/search/search-global.use-case';
import { PrismaSearchRead } from './infrastructure/prisma-search-read';
import { SearchController } from './interface/http/search.controller';

/** Global search (PRD §7.6, HU-26). Not imported by `AppModule` before package 6.1. */
@Module({
  controllers: [SearchController],
  providers: [
    { provide: SEARCH_READ, useClass: PrismaSearchRead },
    {
      provide: SearchGlobal,
      useFactory: (authorization: AuthorizationPort, search: SearchReadPort) =>
        new SearchGlobal(authorization, search),
      inject: [AUTHORIZATION, SEARCH_READ],
    },
  ],
  exports: [SearchGlobal],
})
export class SearchModule {}
