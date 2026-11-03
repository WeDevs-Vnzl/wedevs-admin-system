import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { GetDashboard } from '../../application/use-cases/dashboard/get-dashboard.use-case';
import { DashboardQueryDto, DashboardResponseDto, toDashboardResponse } from './dashboard.dto';

/**
 * The first screen (PRD §8.1). `@Authenticated()`: every role opens it and the use case decides by data what
 * is in it (`canSeeFinancials`, `read document`, `read activity`).
 */
@ApiTags('intelligence')
@Controller('dashboard')
@Authenticated()
export class DashboardController {
  constructor(private readonly getDashboard: GetDashboard) {}

  @Get()
  @ApiOperation({
    operationId: 'getDashboard',
    summary: 'The eight cards of a month, quarter or year, the twelve-month chart and the panels',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async dashboard(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardResponseDto> {
    return toDashboardResponse(await this.getDashboard.execute(user, query));
  }
}
