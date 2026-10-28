import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import type { TechnologyView } from '../../application/technology-view';
import { CreateTechnology } from '../../application/use-cases/create-technology.use-case';
import { DeleteTechnology } from '../../application/use-cases/delete-technology.use-case';
import { GetTechnology } from '../../application/use-cases/get-technology.use-case';
import { ListTechnologies } from '../../application/use-cases/list-technologies.use-case';
import { SetTechnologyActive } from '../../application/use-cases/set-technology-active.use-case';
import { UpdateTechnology } from '../../application/use-cases/update-technology.use-case';
import {
  CreateTechnologyDto,
  ListTechnologiesQueryDto,
  SetTechnologyActiveDto,
  TechnologyDeletedDto,
  TechnologyIdParamsDto,
  TechnologyListResponseDto,
  TechnologyViewDto,
  UpdateTechnologyDto,
} from './dto/technologies.dto';

/**
 * Settings → Tecnologías (PRD §8.15, HU-06). Reads are for every signed-in role (DT-71); writes need the
 * `settings` grant, and the use case runs `can()` as the authority (C13).
 */
@ApiTags('settings')
@Controller('technologies')
export class TechnologiesController {
  constructor(
    private readonly listTechnologies: ListTechnologies,
    private readonly getTechnology: GetTechnology,
    private readonly createTechnology: CreateTechnology,
    private readonly updateTechnology: UpdateTechnology,
    private readonly setTechnologyActive: SetTechnologyActive,
    private readonly deleteTechnology: DeleteTechnology,
  ) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    operationId: 'listTechnologies',
    summary: 'Technology catalog (any signed-in user)',
  })
  @ApiOkResponse({ type: TechnologyListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListTechnologiesQueryDto,
  ): Promise<TechnologyListResponseDto> {
    const page = await this.listTechnologies.execute(user, query);
    return { ...page, items: page.items.map(toResponse) };
  }

  @Get(':id')
  @Authenticated()
  @ApiOperation({ operationId: 'getTechnology', summary: 'One technology with its usage count' })
  @ApiOkResponse({ type: TechnologyViewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: TechnologyIdParamsDto,
  ): Promise<TechnologyViewDto> {
    return toResponse(await this.getTechnology.execute(user, { id: params.id }));
  }

  @Post()
  @RequiresGrant('settings', 'create')
  @ApiOperation({
    operationId: 'createTechnology',
    summary: 'Create a technology (settings grant)',
  })
  @ApiBody({ type: CreateTechnologyDto })
  @ApiCreatedResponse({ type: TechnologyViewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateTechnologyDto,
  ): Promise<TechnologyViewDto> {
    return toResponse(await this.createTechnology.execute(user, body));
  }

  @Patch(':id')
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'updateTechnology',
    summary: 'Replace a technology (settings grant)',
  })
  @ApiBody({ type: UpdateTechnologyDto })
  @ApiOkResponse({ type: TechnologyViewDto })
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
    @Param() params: TechnologyIdParamsDto,
    @Body() body: UpdateTechnologyDto,
  ): Promise<TechnologyViewDto> {
    return toResponse(await this.updateTechnology.execute(user, { ...body, id: params.id }));
  }

  @Post(':id/active')
  @HttpCode(200)
  @RequiresGrant('settings', 'update')
  @ApiOperation({
    operationId: 'setTechnologyActive',
    summary: 'Activate or deactivate a technology (settings grant)',
  })
  @ApiBody({ type: SetTechnologyActiveDto })
  @ApiOkResponse({ type: TechnologyViewDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async setActive(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: TechnologyIdParamsDto,
    @Body() body: SetTechnologyActiveDto,
  ): Promise<TechnologyViewDto> {
    return toResponse(
      await this.setTechnologyActive.execute(user, { id: params.id, active: body.active }),
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @RequiresGrant('settings', 'delete')
  @ApiOperation({
    operationId: 'deleteTechnology',
    summary: 'Delete an unused technology (settings grant; in use is locked)',
  })
  @ApiOkResponse({ type: TechnologyDeletedDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTEGRITY_LOCK', 'INTERNAL')
  async remove(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: TechnologyIdParamsDto,
  ): Promise<TechnologyDeletedDto> {
    return this.deleteTechnology.execute(user, { id: params.id });
  }
}

/** Output of the use cases to the wire shape: the fields listed in the DTO, nothing else. */
function toResponse(view: TechnologyView): TechnologyViewDto {
  return {
    id: view.id,
    name: view.name,
    nameEn: view.nameEn,
    slug: view.slug,
    category: view.category,
    iconSlug: view.iconSlug,
    color: view.color,
    active: view.active,
    usageCount: view.usageCount,
  };
}
