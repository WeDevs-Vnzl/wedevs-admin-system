import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { SearchGlobal } from '../../application/use-cases/search/search-global.use-case';
import { SearchQueryDto, SearchResultsDto, toSearchResponse } from './search.dto';

/**
 * Global search (PRD §7.6, HU-26). `@Authenticated()` because the grant is per record type: the use case
 * runs `can(read)` for each and leaves out the ones the caller may not see (C13).
 */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchGlobal: SearchGlobal) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    operationId: 'searchGlobal',
    summary: 'Global search over every record type the caller may read (prefixes c: p: f: d: n:)',
  })
  @ApiOkResponse({ type: SearchResultsDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async search(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: SearchQueryDto,
  ): Promise<SearchResultsDto> {
    return toSearchResponse(await this.searchGlobal.execute(user, query));
  }
}
