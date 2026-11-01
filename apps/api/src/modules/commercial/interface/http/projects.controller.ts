import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { ArchiveProjects } from '../../application/use-cases/archive-projects.use-case';
import { CreateProject } from '../../application/use-cases/create-project.use-case';
import { GetProject } from '../../application/use-cases/get-project.use-case';
import { ListProjects } from '../../application/use-cases/list-projects.use-case';
import { RemoveProjectLink } from '../../application/use-cases/remove-project-link.use-case';
import { ReorderProjectLinks } from '../../application/use-cases/reorder-project-links.use-case';
import { RestoreProject } from '../../application/use-cases/restore-project.use-case';
import { SetProjectClients } from '../../application/use-cases/set-project-clients.use-case';
import { SetProjectStatus } from '../../application/use-cases/set-project-status.use-case';
import { SetProjectTechnologies } from '../../application/use-cases/set-project-technologies.use-case';
import { UpdateProject } from '../../application/use-cases/update-project.use-case';
import { UpsertProjectLinks } from '../../application/use-cases/upsert-project-links.use-case';
import type {
  ProjectDetailView,
  ProjectLinkRecord,
  ProjectListRowView,
} from '../../application/use-cases/project-views';
import {
  ArchiveProjectDto,
  ArchiveProjectsDto,
  ArchivedProjectDto,
  ArchivedProjectsDto,
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectDetailDto,
  ProjectIdParamsDto,
  ProjectLinkParamsDto,
  ProjectLinksResponseDto,
  ProjectListResponseDto,
  ProjectStatusChangeDto,
  ReorderProjectLinksDto,
  RestoredProjectDto,
  SetProjectClientsDto,
  SetProjectStatusDto,
  SetProjectTechnologiesDto,
  UpdateProjectDto,
  UpsertProjectLinksDto,
} from './dto/projects.dto';
import { toEntityRefResponse } from './dto/contacts.dto';

/**
 * Projects (PRD §8.3, HU-05…HU-08). Every handler declares its grant; the use case runs `can()` as the
 * authority (C13). Member holds read + update on projects, never create or delete.
 */
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly listProjects: ListProjects,
    private readonly getProject: GetProject,
    private readonly createProject: CreateProject,
    private readonly updateProject: UpdateProject,
    private readonly setProjectClients: SetProjectClients,
    private readonly setProjectTechnologies: SetProjectTechnologies,
    private readonly upsertProjectLinks: UpsertProjectLinks,
    private readonly reorderProjectLinks: ReorderProjectLinks,
    private readonly removeProjectLink: RemoveProjectLink,
    private readonly setProjectStatus: SetProjectStatus,
    private readonly archiveProjects: ArchiveProjects,
    private readonly restoreProject: RestoreProject,
  ) {}

  @Get()
  @RequiresGrant('project', 'read')
  @ApiOperation({ operationId: 'listProjects', summary: 'List projects (filters, search, sort)' })
  @ApiOkResponse({ type: ProjectListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListProjectsQueryDto,
  ): Promise<ProjectListResponseDto> {
    const page = await this.listProjects.execute(user, query);
    return { ...page, items: page.items.map(toRow) };
  }

  @Post()
  @RequiresGrant('project', 'create')
  @ApiOperation({ operationId: 'createProject', summary: 'Create a project (PRY-####)' })
  @ApiBody({ type: CreateProjectDto })
  @ApiCreatedResponse({ type: ProjectDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateProjectDto,
  ): Promise<ProjectDetailDto> {
    return toDetail(await this.createProject.execute(user, body));
  }

  @Post('archive')
  @HttpCode(200)
  @RequiresGrant('project', 'delete')
  @ApiOperation({
    operationId: 'archiveProjects',
    summary: 'Archive several projects, all or nothing',
  })
  @ApiBody({ type: ArchiveProjectsDto })
  @ApiOkResponse({ type: ArchivedProjectsDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async archiveMany(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: ArchiveProjectsDto,
  ): Promise<ArchivedProjectsDto> {
    const archived = await this.archiveProjects.execute(user, body);
    return { archived: archived.map(toArchived) };
  }

  @Get(':id')
  @RequiresGrant('project', 'read')
  @ApiOperation({ operationId: 'getProject', summary: 'One project (archived: trash roles only)' })
  @ApiOkResponse({ type: ProjectDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
  ): Promise<ProjectDetailDto> {
    return toDetail(await this.getProject.execute(user, params.id));
  }

  @Patch(':id')
  @RequiresGrant('project', 'update')
  @ApiOperation({
    operationId: 'updateProject',
    summary: 'Replace the editable fields of a project',
  })
  @ApiBody({ type: UpdateProjectDto })
  @ApiOkResponse({ type: ProjectDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
    @Body() body: UpdateProjectDto,
  ): Promise<ProjectDetailDto> {
    return toDetail(await this.updateProject.execute(user, { ...body, id: params.id }));
  }

  @Put(':id/clients')
  @RequiresGrant('project', 'update')
  @ApiOperation({ operationId: 'setProjectClients', summary: 'Replace the clients of a project' })
  @ApiBody({ type: SetProjectClientsDto })
  @ApiOkResponse({ type: ProjectDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async setClients(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
    @Body() body: SetProjectClientsDto,
  ): Promise<ProjectDetailDto> {
    return toDetail(await this.setProjectClients.execute(user, { id: params.id, ...body }));
  }

  @Put(':id/technologies')
  @RequiresGrant('project', 'update')
  @ApiOperation({
    operationId: 'setProjectTechnologies',
    summary: 'Replace the stack of a project (active technologies only)',
  })
  @ApiBody({ type: SetProjectTechnologiesDto })
  @ApiOkResponse({ type: ProjectDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async setTechnologies(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
    @Body() body: SetProjectTechnologiesDto,
  ): Promise<ProjectDetailDto> {
    return toDetail(await this.setProjectTechnologies.execute(user, { id: params.id, ...body }));
  }

  @Put(':id/links')
  @RequiresGrant('project', 'update')
  @ApiOperation({
    operationId: 'upsertProjectLinks',
    summary: 'Create the links without id and update the ones with id',
  })
  @ApiBody({ type: UpsertProjectLinksDto })
  @ApiOkResponse({ type: ProjectLinksResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async upsertLinks(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
    @Body() body: UpsertProjectLinksDto,
  ): Promise<ProjectLinksResponseDto> {
    const links = await this.upsertProjectLinks.execute(user, { id: params.id, ...body });
    return { links: links.map(toLink) };
  }

  @Post(':id/links/reorder')
  @HttpCode(200)
  @RequiresGrant('project', 'update')
  @ApiOperation({ operationId: 'reorderProjectLinks', summary: 'Reorder the links of one group' })
  @ApiBody({ type: ReorderProjectLinksDto })
  @ApiOkResponse({ type: ProjectLinksResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async reorderLinks(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
    @Body() body: ReorderProjectLinksDto,
  ): Promise<ProjectLinksResponseDto> {
    const links = await this.reorderProjectLinks.execute(user, { id: params.id, ...body });
    return { links: links.map(toLink) };
  }

  @Delete(':id/links/:linkId')
  @HttpCode(200)
  @RequiresGrant('project', 'update')
  @ApiOperation({ operationId: 'removeProjectLink', summary: 'Remove one link of a project' })
  @ApiOkResponse({ type: ProjectLinksResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async removeLink(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectLinkParamsDto,
  ): Promise<ProjectLinksResponseDto> {
    const links = await this.removeProjectLink.execute(user, {
      id: params.id,
      linkId: params.linkId,
    });
    return { links: links.map(toLink) };
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequiresGrant('project', 'update')
  @ApiOperation({
    operationId: 'setProjectStatus',
    summary: 'Change the status of a project (transition rules, dates, cancel options)',
  })
  @ApiBody({ type: SetProjectStatusDto })
  @ApiOkResponse({ type: ProjectStatusChangeDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async setStatus(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
    @Body() body: SetProjectStatusDto,
  ): Promise<ProjectStatusChangeDto> {
    const result = await this.setProjectStatus.execute(user, { id: params.id, ...body });
    return { project: toDetail(result.project), hints: [...result.hints] };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequiresGrant('project', 'delete')
  @ApiOperation({
    operationId: 'archiveProject',
    summary: 'Archive a project (active billing asks for confirm)',
  })
  @ApiBody({ type: ArchiveProjectDto })
  @ApiOkResponse({ type: ArchivedProjectDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async archive(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
    @Body() body: ArchiveProjectDto,
  ): Promise<ArchivedProjectDto> {
    const [archived] = await this.archiveProjects.execute(user, {
      ids: [params.id],
      confirm: body.confirm,
    });
    if (!archived) throw new Error('unreachable: one id yields one archived project');
    return toArchived(archived);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequiresGrant('project', 'restore')
  @ApiOperation({ operationId: 'restoreProject', summary: 'Restore an archived project' })
  @ApiOkResponse({ type: RestoredProjectDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async restore(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ProjectIdParamsDto,
  ): Promise<RestoredProjectDto> {
    const restored = await this.restoreProject.execute(user, params.id);
    return {
      entity: toEntityRefResponse(restored.entity),
      restoredAt: restored.restoredAt.toISOString(),
    };
  }
}

// ───────────────────────────── Output mapping ─────────────────────────────

function toLink(link: ProjectLinkRecord) {
  return { id: link.id, group: link.group, label: link.label, url: link.url, order: link.order };
}

function toArchived(archived: { id: string; archivedAt: Date }) {
  return { id: archived.id, archivedAt: archived.archivedAt.toISOString() };
}

function toRow(row: ProjectListRowView) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    clients: row.clients.map((item) => ({
      client: toEntityRefResponse(item.client),
      role: item.role,
    })),
    status: row.status,
    startDate: row.startDate,
    targetEndDate: row.targetEndDate,
    stack: row.stack.map((tech) => ({ ...tech })),
    tags: row.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    contractedValueUsd: row.contractedValueUsd,
    invoicedUsd: row.invoicedUsd,
    collectedUsd: row.collectedUsd,
    toInvoiceUsd: row.toInvoiceUsd,
  };
}

function toDetail(view: ProjectDetailView): ProjectDetailDto {
  return {
    ...toRow(view),
    summary: view.summary,
    description: view.description
      ? { type: 'doc', ...(view.description.content ? { content: view.description.content } : {}) }
      : null,
    endDate: view.endDate,
    links: view.links.map(toLink),
    hasBillingPlan: view.hasBillingPlan,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}
