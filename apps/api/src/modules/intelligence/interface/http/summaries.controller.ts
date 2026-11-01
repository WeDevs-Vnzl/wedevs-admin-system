import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { GetClientSummary } from '../../application/use-cases/dashboard/get-client-summary.use-case';
import { GetProjectSummary } from '../../application/use-cases/dashboard/get-project-summary.use-case';
import { ClientSummaryResponseDto, ProjectSummaryResponseDto } from './summaries.dto';

/**
 * The financial summaries of a client and of a project (PRD §8.2, §8.4.4, DT-113). The route needs `read` on
 * the record; the use case adds the `canSeeFinancials` gate and answers `FORBIDDEN` without it.
 */
@ApiTags('intelligence')
@Controller()
export class SummariesController {
  constructor(
    private readonly getClientSummary: GetClientSummary,
    private readonly getProjectSummary: GetProjectSummary,
  ) {}

  @Get('clients/:id/summary')
  @RequiresGrant('client', 'read')
  @ApiOperation({
    operationId: 'getClientSummary',
    summary: 'Financial summary of a client (USD) with the rolling twelve-month collection',
  })
  @ApiOkResponse({ type: ClientSummaryResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async client(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
  ): Promise<ClientSummaryResponseDto> {
    return this.getClientSummary.execute(user, { id });
  }

  @Get('projects/:id/summary')
  @RequiresGrant('project', 'read')
  @ApiOperation({
    operationId: 'getProjectSummary',
    summary: 'Financial summary of a project (PRD §8.4.4, USD)',
  })
  @ApiOkResponse({ type: ProjectSummaryResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async project(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
  ): Promise<ProjectSummaryResponseDto> {
    return this.getProjectSummary.execute(user, { id });
  }
}
