import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TechnologyUsageQueries } from '../commercial/application/technology-usage.queries';
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
import { CommercialTechnologyUsageAdapter } from './infrastructure/commercial-technology-usage.adapter';
import { PrismaTechnologyRepository } from './infrastructure/prisma-technology.repository';
import { TechnologiesController } from './interface/http/technologies.controller';

/**
 * Settings → Tecnologías (PRD §8.15, HU-06): the catalog reads and writes, and the exported
 * `TechnologyCatalog` that commercial's stack check consumes. `TECHNOLOGY_USAGE` is bound to commercial's
 * `TechnologyUsageQueries` through a lazy `ModuleRef` lookup: `ProjectsModule` imports this module, so a
 * module import back would be circular. Writes run `can()` in their use case under
 * the `settings` grant; reads are for every signed-in role (DT-71).
 */
@Module({
  controllers: [TechnologiesController],
  providers: [
    { provide: TECHNOLOGY_REPOSITORY, useClass: PrismaTechnologyRepository },
    {
      provide: TECHNOLOGY_USAGE,
      useFactory: (moduleRef: ModuleRef) =>
        new CommercialTechnologyUsageAdapter(() =>
          moduleRef.get(TechnologyUsageQueries, { strict: false }),
        ),
      inject: [ModuleRef],
    },
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
  exports: [TechnologyCatalog, TECHNOLOGY_USAGE],
})
export class TechnologiesModule {}
