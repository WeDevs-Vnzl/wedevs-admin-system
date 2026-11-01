import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClientMetricsWriterPort } from '../../shared/application/ports/client-metrics-writer.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import type { SequencePort } from '../../shared/application/ports/sequence.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLIENT_METRICS_WRITER,
  CLOCK,
  ID_GENERATOR,
  SEARCH_INDEX,
  SEQUENCE,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { RESTORE_HANDLER_REGISTRY } from '../platform/application/ports/restore-handler.port';
import type { RestoreHandlerRegistry } from '../platform/application/restore-handler.registry';
import { FinanceDependentsModule } from '../finance/finance-dependents.module';
import { TrashModule } from '../platform/trash.module';
import { TAGGABLE_TARGET_REGISTRY } from '../settings/application/ports/taggable-target.port';
import { TagAssignments } from '../settings/application/tag-assignments';
import type { TaggableTargetRegistry } from '../settings/application/taggable-target.registry';
import { TechnologyCatalog } from '../settings/application/technology-catalog';
import { TagsModule } from '../settings/tags.module';
import { TechnologiesModule } from '../settings/technologies.module';
import { PROJECT_BILLING, type ProjectBillingPort } from './application/ports/project-billing.port';
import {
  PROJECT_TECHNOLOGY_CATALOG,
  type ProjectTechnologyCatalogPort,
} from './application/ports/project-technology-catalog.port';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from './application/ports/project.repository.port';
import { TechnologyUsageQueries } from './application/technology-usage.queries';
import { ArchiveProjects } from './application/use-cases/archive-projects.use-case';
import { CreateProject } from './application/use-cases/create-project.use-case';
import { GetProject } from './application/use-cases/get-project.use-case';
import { ListProjects } from './application/use-cases/list-projects.use-case';
import { ProjectReferences } from './application/use-cases/project-references';
import { ProjectSync } from './application/use-cases/project-sync';
import { ProjectViews } from './application/use-cases/project-views';
import { RemoveProjectLink } from './application/use-cases/remove-project-link.use-case';
import { ReorderProjectLinks } from './application/use-cases/reorder-project-links.use-case';
import { RestoreProject } from './application/use-cases/restore-project.use-case';
import { SetProjectClients } from './application/use-cases/set-project-clients.use-case';
import { SetProjectStatus } from './application/use-cases/set-project-status.use-case';
import { SetProjectTechnologies } from './application/use-cases/set-project-technologies.use-case';
import { UpdateProject } from './application/use-cases/update-project.use-case';
import { UpsertProjectLinks } from './application/use-cases/upsert-project-links.use-case';
import { PrismaProjectRepository } from './infrastructure/prisma-project.repository';
import { ProjectRestoreHandler } from './infrastructure/project-restore.handler';
import { ProjectTaggableResolver } from './infrastructure/project-taggable.resolver';
import { SettingsTechnologyCatalogAdapter } from './infrastructure/settings-technology-catalog.adapter';
import { ProjectsController } from './interface/http/projects.controller';

/**
 * Commercial → Proyectos (PRD §8.3, HU-05…HU-08). Binds the repository, takes the billing port from finance's
 * `FinanceDependentsModule` and binds settings' technology catalog; registers the `PROJECT` restore handler in the trash and
 * the `PROJECT` taggable resolver in the tag registry. Exports `TechnologyUsageQueries`, which package
 * 4.1 binds to settings' `TechnologyUsagePort`.
 */
@Module({
  imports: [TechnologiesModule, TagsModule, TrashModule, FinanceDependentsModule],
  controllers: [ProjectsController],
  providers: [
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    {
      provide: PROJECT_TECHNOLOGY_CATALOG,
      useFactory: (catalog: TechnologyCatalog) => new SettingsTechnologyCatalogAdapter(catalog),
      inject: [TechnologyCatalog],
    },
    {
      provide: ProjectReferences,
      useFactory: (projects: ProjectRepository, catalog: ProjectTechnologyCatalogPort) =>
        new ProjectReferences(projects, catalog),
      inject: [PROJECT_REPOSITORY, PROJECT_TECHNOLOGY_CATALOG],
    },
    {
      provide: ProjectSync,
      useFactory: (
        projects: ProjectRepository,
        searchIndex: SearchIndexPort,
        metrics: ClientMetricsWriterPort,
        activityLog: ActivityLogPort,
      ) => new ProjectSync(projects, searchIndex, metrics, activityLog),
      inject: [PROJECT_REPOSITORY, SEARCH_INDEX, CLIENT_METRICS_WRITER, ACTIVITY_LOG],
    },
    {
      provide: ProjectViews,
      useFactory: (
        authorization: AuthorizationPort,
        projects: ProjectRepository,
        catalog: ProjectTechnologyCatalogPort,
        tags: TagAssignments,
        billing: ProjectBillingPort,
      ) => new ProjectViews(authorization, projects, catalog, tags, billing),
      inject: [
        AUTHORIZATION,
        PROJECT_REPOSITORY,
        PROJECT_TECHNOLOGY_CATALOG,
        TagAssignments,
        PROJECT_BILLING,
      ],
    },
    {
      provide: TechnologyUsageQueries,
      useFactory: (projects: ProjectRepository) => new TechnologyUsageQueries(projects),
      inject: [PROJECT_REPOSITORY],
    },
    {
      provide: ListProjects,
      useFactory: (
        authorization: AuthorizationPort,
        projects: ProjectRepository,
        views: ProjectViews,
      ) => new ListProjects(authorization, projects, views),
      inject: [AUTHORIZATION, PROJECT_REPOSITORY, ProjectViews],
    },
    {
      provide: GetProject,
      useFactory: (
        authorization: AuthorizationPort,
        projects: ProjectRepository,
        views: ProjectViews,
      ) => new GetProject(authorization, projects, views),
      inject: [AUTHORIZATION, PROJECT_REPOSITORY, ProjectViews],
    },
    {
      provide: CreateProject,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        references: ProjectReferences,
        sync: ProjectSync,
        views: ProjectViews,
        tags: TagAssignments,
        sequence: SequencePort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) =>
        new CreateProject(
          authorization,
          uow,
          projects,
          references,
          sync,
          views,
          tags,
          sequence,
          clock,
          ids,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PROJECT_REPOSITORY,
        ProjectReferences,
        ProjectSync,
        ProjectViews,
        TagAssignments,
        SEQUENCE,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: UpdateProject,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        references: ProjectReferences,
        sync: ProjectSync,
        views: ProjectViews,
        tags: TagAssignments,
        clock: ClockPort,
      ) => new UpdateProject(authorization, uow, projects, references, sync, views, tags, clock),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PROJECT_REPOSITORY,
        ProjectReferences,
        ProjectSync,
        ProjectViews,
        TagAssignments,
        CLOCK,
      ],
    },
    {
      provide: SetProjectClients,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        references: ProjectReferences,
        sync: ProjectSync,
        views: ProjectViews,
        clock: ClockPort,
      ) => new SetProjectClients(authorization, uow, projects, references, sync, views, clock),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PROJECT_REPOSITORY,
        ProjectReferences,
        ProjectSync,
        ProjectViews,
        CLOCK,
      ],
    },
    {
      provide: SetProjectTechnologies,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        references: ProjectReferences,
        sync: ProjectSync,
        views: ProjectViews,
      ) => new SetProjectTechnologies(authorization, uow, projects, references, sync, views),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PROJECT_REPOSITORY,
        ProjectReferences,
        ProjectSync,
        ProjectViews,
      ],
    },
    {
      provide: UpsertProjectLinks,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        sync: ProjectSync,
        ids: IdGeneratorPort,
      ) => new UpsertProjectLinks(authorization, uow, projects, sync, ids),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PROJECT_REPOSITORY, ProjectSync, ID_GENERATOR],
    },
    {
      provide: ReorderProjectLinks,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        sync: ProjectSync,
      ) => new ReorderProjectLinks(authorization, uow, projects, sync),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PROJECT_REPOSITORY, ProjectSync],
    },
    {
      provide: RemoveProjectLink,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        sync: ProjectSync,
      ) => new RemoveProjectLink(authorization, uow, projects, sync),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PROJECT_REPOSITORY, ProjectSync],
    },
    {
      provide: SetProjectStatus,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        billing: ProjectBillingPort,
        sync: ProjectSync,
        views: ProjectViews,
      ) => new SetProjectStatus(authorization, uow, projects, billing, sync, views),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PROJECT_REPOSITORY,
        PROJECT_BILLING,
        ProjectSync,
        ProjectViews,
      ],
    },
    {
      provide: ArchiveProjects,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        billing: ProjectBillingPort,
        sync: ProjectSync,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
      ) => new ArchiveProjects(authorization, uow, projects, billing, sync, searchIndex, clock),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PROJECT_REPOSITORY,
        PROJECT_BILLING,
        ProjectSync,
        SEARCH_INDEX,
        CLOCK,
      ],
    },
    {
      provide: RestoreProject,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: ProjectRepository,
        sync: ProjectSync,
        clock: ClockPort,
      ) => new RestoreProject(authorization, uow, projects, sync, clock),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PROJECT_REPOSITORY, ProjectSync, CLOCK],
    },
    {
      provide: ProjectRestoreHandler,
      useFactory: (restore: RestoreProject) => new ProjectRestoreHandler(restore),
      inject: [RestoreProject],
    },
    {
      provide: ProjectTaggableResolver,
      useFactory: (projects: ProjectRepository) => new ProjectTaggableResolver(projects),
      inject: [PROJECT_REPOSITORY],
    },
  ],
  exports: [TechnologyUsageQueries, ListProjects],
})
export class ProjectsModule implements OnModuleInit {
  constructor(
    @Inject(RESTORE_HANDLER_REGISTRY) private readonly restoreHandlers: RestoreHandlerRegistry,
    @Inject(TAGGABLE_TARGET_REGISTRY) private readonly taggable: TaggableTargetRegistry,
    private readonly restoreHandler: ProjectRestoreHandler,
    private readonly taggableResolver: ProjectTaggableResolver,
  ) {}

  onModuleInit(): void {
    this.restoreHandlers.register(this.restoreHandler);
    this.taggable.register(this.taggableResolver);
  }
}
