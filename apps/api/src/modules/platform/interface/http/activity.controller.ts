import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import type { ActivityRowOutput } from '../../application/use-cases/list-activity.use-case';
import { ListActivity } from '../../application/use-cases/list-activity.use-case';
import {
  ActivityListResponseDto,
  ListActivityQueryDto,
  type ActivityRowDto,
} from './dto/activity.dto';

function toActivityRowDto(row: ActivityRowOutput): ActivityRowDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Activity log, read only (HU-29 CA2): there is no other method under `/activity`, so an entry can be
 * neither changed nor removed through the API (C20). Owner and Admin only (`can(read, activity)`).
 */
@ApiTags('platform')
@Controller('activity')
export class ActivityController {
  constructor(private readonly listActivity: ListActivity) {}

  @Get()
  @RequiresGrant('activity', 'read')
  @ApiOperation({
    operationId: 'listActivity',
    summary: 'Activity log, newest first, IP masked (Owner, Admin)',
  })
  @ApiOkResponse({ type: ActivityListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListActivityQueryDto,
  ): Promise<ActivityListResponseDto> {
    const page = await this.listActivity.execute(user, query);
    return { ...page, items: page.items.map(toActivityRowDto) };
  }
}
