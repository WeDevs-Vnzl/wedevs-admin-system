import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import { TaggableTargetRegistry } from '../../../src/modules/settings/application/taggable-target.registry';
import { AssignTags } from '../../../src/modules/settings/application/use-cases/assign-tags.use-case';
import { CreateTag } from '../../../src/modules/settings/application/use-cases/create-tag.use-case';
import { GetTag } from '../../../src/modules/settings/application/use-cases/get-tag.use-case';
import { ListTags } from '../../../src/modules/settings/application/use-cases/list-tags.use-case';
import { UnassignTag } from '../../../src/modules/settings/application/use-cases/unassign-tag.use-case';
import { UpdateTag } from '../../../src/modules/settings/application/use-cases/update-tag.use-case';
import type { Tag } from '../../../src/modules/settings/domain/tag';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import type { UserRole } from '../../../src/shared/domain/enums';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import {
  FakeTaggableTargetResolver,
  InMemoryTagAssignmentRepository,
  InMemoryTagRepository,
} from './fakes';

export function userOf(role: UserRole): CurrentUser {
  return {
    userId: `usr_${role.toLowerCase()}`,
    clerkId: `clerk_${role.toLowerCase()}`,
    role,
    email: `${role.toLowerCase()}@example.test`,
    name: role,
  };
}

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

/** Every in-memory port of the tags slice, wired with the real use cases and the real matrix. */
export function createWorld() {
  const clock = new FixedClock();
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const authorization = new MatrixAuthorization();
  const archived = new Set<string>();
  const assignmentRepo = new InMemoryTagAssignmentRepository(uow);
  const tagRepo = new InMemoryTagRepository(uow, assignmentRepo, {
    isLive: (key) => !archived.has(key),
  });
  const registry = new TaggableTargetRegistry();
  const clients = new FakeTaggableTargetResolver('CLIENT', 'client');
  const projects = new FakeTaggableTargetResolver('PROJECT', 'project');
  const notes = new FakeTaggableTargetResolver('NOTE', 'note');
  registry.register(clients);
  registry.register(projects);
  registry.register(notes);
  const assignments = new TagAssignments(tagRepo, assignmentRepo);
  const ids = new SequentialIdGenerator('tag');

  return {
    clock,
    uow,
    activity,
    authorization,
    archived,
    assignmentRepo,
    tagRepo,
    registry,
    clients,
    projects,
    notes,
    assignments,
    ids,
    listTags: new ListTags(tagRepo),
    getTag: new GetTag(tagRepo),
    createTag: new CreateTag(authorization, uow, tagRepo, activity, clock, ids),
    updateTag: new UpdateTag(authorization, uow, tagRepo, activity),
    assignTags: new AssignTags(authorization, registry, uow, assignments, activity),
    unassignTag: new UnassignTag(authorization, registry, uow, assignments, activity),
    seedTag(id: string, name: string, color = '#112233', createdAt = '2026-01-01T00:00:00.000Z') {
      const tag: Tag = { id, name, color, createdAt: new Date(createdAt) };
      tagRepo.seed(tag);
      return tag;
    },
  };
}
export type World = ReturnType<typeof createWorld>;
