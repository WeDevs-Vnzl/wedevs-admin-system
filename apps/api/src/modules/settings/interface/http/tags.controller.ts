import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { AssignTags } from '../../application/use-cases/assign-tags.use-case';
import { CreateTag } from '../../application/use-cases/create-tag.use-case';
import { GetTag } from '../../application/use-cases/get-tag.use-case';
import { ListTags, type TagOutput } from '../../application/use-cases/list-tags.use-case';
import { UnassignTag } from '../../application/use-cases/unassign-tag.use-case';
import { UpdateTag } from '../../application/use-cases/update-tag.use-case';
import {
  AssignTagsDto,
  CreateTagDto,
  ListTagsQueryDto,
  TagChipsResponseDto,
  TagDto,
  TagListResponseDto,
  UnassignTagDto,
  UpdateTagDto,
} from './dto/tags.dto';

/**
 * Tags catalog and assignment (PRD §7.5, §8.15). Reads are a reference catalog for every signed-in user
 * (DT-71). Create and assign/unassign are `@Authenticated()` at the route because their grant depends on
 * the body (any create-tag grant; `update` on the target's own resource); the use cases run `can()`.
 */
@ApiTags('settings')
@Controller('tags')
export class TagsController {
  constructor(
    private readonly listTags: ListTags,
    private readonly getTag: GetTag,
    private readonly createTag: CreateTag,
    private readonly updateTag: UpdateTag,
    private readonly assignTags: AssignTags,
    private readonly unassignTag: UnassignTag,
  ) {}

  @Get()
  @Authenticated()
  @ApiOperation({ operationId: 'listTags', summary: 'List tags with usage (any signed-in user)' })
  @ApiOkResponse({ type: TagListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListTagsQueryDto,
  ): Promise<TagListResponseDto> {
    const page = await this.listTags.execute(user, query);
    return { ...page, items: page.items.map(toTagDto) };
  }

  @Post('assign')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({
    operationId: 'assignTags',
    summary: 'Add tags to a record (update on the record resource)',
  })
  @ApiOkResponse({ type: TagChipsResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async assign(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: AssignTagsDto,
  ): Promise<TagChipsResponseDto> {
    return { items: await this.assignTags.execute(user, body) };
  }

  @Post('unassign')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({
    operationId: 'unassignTag',
    summary: 'Remove a tag from a record (update on the record resource)',
  })
  @ApiOkResponse({ type: TagChipsResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async unassign(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: UnassignTagDto,
  ): Promise<TagChipsResponseDto> {
    return { items: await this.unassignTag.execute(user, body) };
  }

  @Get(':id')
  @Authenticated()
  @ApiOperation({ operationId: 'getTag', summary: 'One tag with usage (any signed-in user)' })
  @ApiOkResponse({ type: TagDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'INTERNAL')
  async get(@CurrentUser() user: CurrentUserModel, @Param('id') id: string): Promise<TagDto> {
    return toTagDto(await this.getTag.execute(user, { id }));
  }

  @Post()
  @Authenticated()
  @ApiOperation({
    operationId: 'createTag',
    summary: 'Create a tag (settings create, or edit client/project, or create note/document)',
  })
  @ApiCreatedResponse({ type: TagDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(@CurrentUser() user: CurrentUserModel, @Body() body: CreateTagDto): Promise<TagDto> {
    return toTagDto(await this.createTag.execute(user, body));
  }

  @Patch(':id')
  @RequiresGrant('settings', 'update')
  @ApiOperation({ operationId: 'updateTag', summary: 'Rename or recolour a tag (settings grant)' })
  @ApiOkResponse({ type: TagDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
    @Body() body: UpdateTagDto,
  ): Promise<TagDto> {
    return toTagDto(await this.updateTag.execute(user, { id, ...body }));
  }
}

function toTagDto(tag: TagOutput): TagDto {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    usageCount: tag.usageCount,
    createdAt: tag.createdAt.toISOString(),
  };
}
