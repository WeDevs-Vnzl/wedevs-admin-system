import { Module } from '@nestjs/common';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { CreateTechnology } from './application/use-cases/create-technology.use-case';
import { DeleteTechnology } from './application/use-cases/delete-technology.use-case';
import { GetTechnology } from './application/use-cases/get-technology.use-case';
import { ListTechnologies } from './application/use-cases/list-technologies.use-case';
import { SetTechnologyActive } from './application/use-cases/set-technology-active.use-case';
import { UpdateTechnology } from './application/use-cases/update-technology.use-case';
import { TechnologyCatalog } from './application/technology-catalog';
import {
  TECHNOLOGY_REPOSITORY,
  type TechnologyRepository,
} from './application/ports/technology.repository.port';
import {
  TECHNOLOGY_USAGE,
  type TechnologyUsagePort,
} from './application/ports/technology-usage.port';
import { PrismaTechnologyRepository } from './infrastructure/prisma-technology.repository';
import { TechnologiesController } from './interface/http/technologies.controller';

/**
 * Placeholder bound to `TECHNOLOGY_USAGE` until package 4.1 binds it to commercial's exported
 * `technology-usage.queries.ts`. It fails closed: a list or delete reaching it errors instead of reading
 * "no projects", so an unbound catalog can never delete a technology a project still uses. No route of
 * this module is in `AppModule` before 4.1, so the placeholder is never reached in production.
 */
class UnboundTechnologyUsage implements TechnologyUsagePort {
  countLiveProjects(): Promise<number> {
    return Promise.reject(new Error('TechnologyUsagePort is not bound (package 4.1)'));
  }

  detachFromArchivedProjects(): Promise<void> {
    return Promise.reject(new Error('TechnologyUsagePort is not bound (package 4.1)'));
  }
}

/**
 * Settings → Tecnologías (PRD §8.15, HU-06): the catalog reads and writes, and the exported
 * `TechnologyCatalog` that commercial's stack check consumes. Writes run `can()` in their use case under
 * the `settings` grant; reads are for every signed-in role (DT-71).
 */
@Module({
  controllers: [TechnologiesController],
  providers: [
    { provide: TECHNOLOGY_REPOSITORY, useClass: PrismaTechnologyRepository },
    { provide: TECHNOLOGY_USAGE, useClass: UnboundTechnologyUsage },
    {
      provide: ListTechnologies,
      useFactory: (technologies: TechnologyRepository, usage: TechnologyUsagePort) =>
        new ListTechnologies(technologies, usage),
      inject: [TECHNOLOGY_REPOSITORY, TECHNOLOGY_USAGE],
    },
    {
      provide: GetTechnology,
      useFactory: (technologies: TechnologyRepository, usage: TechnologyUsagePort) =>
        new GetTechnology(technologies, usage),
      inject: [TECHNOLOGY_REPOSITORY, TECHNOLOGY_USAGE],
    },
    {
      provide: CreateTechnology,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        technologies: TechnologyRepository,
        activityLog: ActivityLogPort,
        ids: IdGeneratorPort,
      ) => new CreateTechnology(authorization, uow, technologies, activityLog, ids),
      inject: [AUTHORIZATION, UNIT_OF_WORK, TECHNOLOGY_REPOSITORY, ACTIVITY_LOG, ID_GENERATOR],
    },
    {
      provide: UpdateTechnology,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        technologies: TechnologyRepository,
        activityLog: ActivityLogPort,
        usage: TechnologyUsagePort,
      ) => new UpdateTechnology(authorization, uow, technologies, activityLog, usage),
      inject: [AUTHORIZATION, UNIT_OF_WORK, TECHNOLOGY_REPOSITORY, ACTIVITY_LOG, TECHNOLOGY_USAGE],
    },
    {
      provide: SetTechnologyActive,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        technologies: TechnologyRepository,
        activityLog: ActivityLogPort,
        usage: TechnologyUsagePort,
      ) => new SetTechnologyActive(authorization, uow, technologies, activityLog, usage),
      inject: [AUTHORIZATION, UNIT_OF_WORK, TECHNOLOGY_REPOSITORY, ACTIVITY_LOG, TECHNOLOGY_USAGE],
    },
    {
      provide: DeleteTechnology,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        technologies: TechnologyRepository,
        activityLog: ActivityLogPort,
        usage: TechnologyUsagePort,
      ) => new DeleteTechnology(authorization, uow, technologies, activityLog, usage),
      inject: [AUTHORIZATION, UNIT_OF_WORK, TECHNOLOGY_REPOSITORY, ACTIVITY_LOG, TECHNOLOGY_USAGE],
    },
    {
      provide: TechnologyCatalog,
      useFactory: (technologies: TechnologyRepository) => new TechnologyCatalog(technologies),
      inject: [TECHNOLOGY_REPOSITORY],
    },
  ],
  exports: [TechnologyCatalog],
})
export class TechnologiesModule {}
