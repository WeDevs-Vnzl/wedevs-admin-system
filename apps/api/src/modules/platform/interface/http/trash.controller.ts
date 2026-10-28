import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import type { TrashableEntityType } from '../../application/ports/restore-handler.port';
import { ListTrash } from '../../application/use-cases/list-trash.use-case';
import { RestoreFromTrash } from '../../application/use-cases/restore-from-trash.use-case';
import {
  ListTrashQueryDto,
  RestoreFromTrashDto,
  RestoredRecordResponseDto,
  TrashListResponseDto,
} from './dto/trash.dto';

const toArray = <T extends string>(
  value: string | readonly string[] | undefined,
): T[] | undefined =>
  value === undefined ? undefined : ((Array.isArray(value) ? [...value] : [value]) as T[]);

const toRef = (entity: EntityRef) => ({
  id: entity.id,
  label: entity.label,
  type: entity.type as TrashableEntityType,
  ...(entity.code !== undefined ? { code: entity.code } : {}),
});

/** Trash (PRD §7.7, HU-28): Owner and Admin list and restore archived records. There is no purge. */
@ApiTags('trash')
@Controller('trash')
export class TrashController {
  constructor(
    private readonly listTrash: ListTrash,
    private readonly restoreFromTrash: RestoreFromTrash,
  ) {}

  @Get()
  @RequiresGrant('trash', 'read')
  @ApiOperation({
    operationId: 'listTrash',
    summary: 'List archived records of the types a context made restorable',
  })
  @ApiOkResponse({ type: TrashListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListTrashQueryDto,
  ): Promise<TrashListResponseDto> {
    const { filters } = query;
    const entityType = toArray<TrashableEntityType>(filters.entityType);
    const deletedById = toArray<string>(filters.deletedById);
    const deletedFrom = toArray<string>(filters.deletedFrom)?.[0];
    const deletedTo = toArray<string>(filters.deletedTo)?.[0];
    const page = await this.listTrash.execute(user, {
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort ?? { field: 'deletedAt', direction: 'desc' },
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(entityType ? { entityType } : {}),
      ...(deletedById ? { deletedById } : {}),
      ...(deletedFrom ? { deletedFrom } : {}),
      ...(deletedTo ? { deletedTo } : {}),
    });
    return {
      ...page,
      items: page.items.map((row) => ({
        entity: toRef(row.entity),
        context: row.context,
        deletedAt: row.deletedAt.toISOString(),
        deletedBy: row.deletedBy,
      })),
    };
  }

  @Post('restore')
  @HttpCode(200)
  @RequiresGrant('trash', 'restore')
  @ApiOperation({
    operationId: 'restoreFromTrash',
    summary: 'Restore an archived record through the owning context’s restore use case',
  })
  @ApiOkResponse({ type: RestoredRecordResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async restore(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: RestoreFromTrashDto,
  ): Promise<RestoredRecordResponseDto> {
    const out = await this.restoreFromTrash.execute(user, body);
    return { entity: toRef(out.entity), restoredAt: out.restoredAt.toISOString() };
  }
}
