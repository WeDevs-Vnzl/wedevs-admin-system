import { Module } from '@nestjs/common';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import {
  TAG_ASSIGNMENT_REPOSITORY,
  type TagAssignmentRepository,
} from './application/ports/tag-assignment.repository.port';
import { TAG_REPOSITORY, type TagRepository } from './application/ports/tag.repository.port';
import { TAGGABLE_TARGET_REGISTRY } from './application/ports/taggable-target.port';
import { TagAssignments } from './application/tag-assignments';
import { TaggableTargetRegistry } from './application/taggable-target.registry';
import { AssignTags } from './application/use-cases/assign-tags.use-case';
import { CreateTag } from './application/use-cases/create-tag.use-case';
import { GetTag } from './application/use-cases/get-tag.use-case';
import { ListTags } from './application/use-cases/list-tags.use-case';
import { UnassignTag } from './application/use-cases/unassign-tag.use-case';
import { UpdateTag } from './application/use-cases/update-tag.use-case';
import { PrismaTagAssignmentRepository } from './infrastructure/prisma-tag-assignment.repository';
import { PrismaTagRepository } from './infrastructure/prisma-tag.repository';
import { TagsController } from './interface/http/tags.controller';

/**
 * Tags (PRD §7.5): the catalog, the assignments and the taggable-target registry. Exports
 * `TagAssignments` (the application API other contexts call inside their own unit of work) and the
 * registry under `TAGGABLE_TARGET_REGISTRY`: each context registers its resolvers from its module's
 * `onModuleInit`, like `FILE_ACCESS_REGISTRY`. Not imported by `SettingsModule`; package 4.1 wires it.
 */
@Module({
  controllers: [TagsController],
  providers: [
    { provide: TAG_REPOSITORY, useClass: PrismaTagRepository },
    { provide: TAG_ASSIGNMENT_REPOSITORY, useClass: PrismaTagAssignmentRepository },
    { provide: TAGGABLE_TARGET_REGISTRY, useValue: new TaggableTargetRegistry() },
    {
      provide: TagAssignments,
      useFactory: (tags: TagRepository, assignments: TagAssignmentRepository) =>
        new TagAssignments(tags, assignments),
      inject: [TAG_REPOSITORY, TAG_ASSIGNMENT_REPOSITORY],
    },
    {
      provide: ListTags,
      useFactory: (tags: TagRepository) => new ListTags(tags),
      inject: [TAG_REPOSITORY],
    },
    {
      provide: GetTag,
      useFactory: (tags: TagRepository) => new GetTag(tags),
      inject: [TAG_REPOSITORY],
    },
    {
      provide: CreateTag,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        tags: TagRepository,
        activityLog: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new CreateTag(authorization, uow, tags, activityLog, clock, ids),
      inject: [AUTHORIZATION, UNIT_OF_WORK, TAG_REPOSITORY, ACTIVITY_LOG, CLOCK, ID_GENERATOR],
    },
    {
      provide: UpdateTag,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        tags: TagRepository,
        activityLog: ActivityLogPort,
      ) => new UpdateTag(authorization, uow, tags, activityLog),
      inject: [AUTHORIZATION, UNIT_OF_WORK, TAG_REPOSITORY, ACTIVITY_LOG],
    },
    {
      provide: AssignTags,
      useFactory: (
        authorization: AuthorizationPort,
        registry: TaggableTargetRegistry,
        uow: UnitOfWorkPort,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
      ) => new AssignTags(authorization, registry, uow, assignments, activityLog),
      inject: [AUTHORIZATION, TAGGABLE_TARGET_REGISTRY, UNIT_OF_WORK, TagAssignments, ACTIVITY_LOG],
    },
    {
      provide: UnassignTag,
      useFactory: (
        authorization: AuthorizationPort,
        registry: TaggableTargetRegistry,
        uow: UnitOfWorkPort,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
      ) => new UnassignTag(authorization, registry, uow, assignments, activityLog),
      inject: [AUTHORIZATION, TAGGABLE_TARGET_REGISTRY, UNIT_OF_WORK, TagAssignments, ACTIVITY_LOG],
    },
  ],
  exports: [TagAssignments, TAGGABLE_TARGET_REGISTRY],
})
export class TagsModule {}
