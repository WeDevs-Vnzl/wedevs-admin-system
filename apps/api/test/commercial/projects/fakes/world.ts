import { ArchiveProjects } from '../../../../src/modules/commercial/application/use-cases/archive-projects.use-case';
import { CreateProject } from '../../../../src/modules/commercial/application/use-cases/create-project.use-case';
import { GetProject } from '../../../../src/modules/commercial/application/use-cases/get-project.use-case';
import { ListProjects } from '../../../../src/modules/commercial/application/use-cases/list-projects.use-case';
import { ProjectReferences } from '../../../../src/modules/commercial/application/use-cases/project-references';
import { ProjectSync } from '../../../../src/modules/commercial/application/use-cases/project-sync';
import { ProjectViews } from '../../../../src/modules/commercial/application/use-cases/project-views';
import { RemoveProjectLink } from '../../../../src/modules/commercial/application/use-cases/remove-project-link.use-case';
import { ReorderProjectLinks } from '../../../../src/modules/commercial/application/use-cases/reorder-project-links.use-case';
import { RestoreProject } from '../../../../src/modules/commercial/application/use-cases/restore-project.use-case';
import { SetProjectClients } from '../../../../src/modules/commercial/application/use-cases/set-project-clients.use-case';
import { SetProjectStatus } from '../../../../src/modules/commercial/application/use-cases/set-project-status.use-case';
import { SetProjectTechnologies } from '../../../../src/modules/commercial/application/use-cases/set-project-technologies.use-case';
import { UpdateProject } from '../../../../src/modules/commercial/application/use-cases/update-project.use-case';
import { UpsertProjectLinks } from '../../../../src/modules/commercial/application/use-cases/upsert-project-links.use-case';
import type { ProjectRecord } from '../../../../src/modules/commercial/domain/project';
import { MatrixAuthorization } from '../../../../src/modules/identity/application/matrix-authorization';
import { TagAssignments } from '../../../../src/modules/settings/application/tag-assignments';
import type { CurrentUser } from '../../../../src/shared/application/current-user';
import type { UserRole } from '../../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../../src/shared/domain/list-query';
import { FixedClock } from '../../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../../support/fakes/in-memory-activity-log';
import { InMemoryClientMetricsWriter } from '../../../support/fakes/in-memory-client-metrics-writer';
import { InMemorySearchIndex } from '../../../support/fakes/in-memory-search-index';
import { InMemorySequence } from '../../../support/fakes/in-memory-sequence';
import { InMemoryUnitOfWork } from '../../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';
import {
  InMemoryTagAssignmentRepository,
  InMemoryTagRepository,
} from '../../../settings/tags/fakes';
import { FakeProjectBilling } from './fake-project-billing';
import { FakeTechnologyCatalog, NEXT_JS, REACT, RUST } from './fake-technology-catalog';
import { InMemoryProjectRepository } from './in-memory-project.repository';

export const actor = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

export const KAIROS = 'cli_kairos';
export const TORNILLO = 'cli_tornillo';
export const ARCHIVED_CLIENT = 'cli_archived';

/** A live project record for seeding the repository. */
export function projectRecord(over: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'pry_kairos_web',
    code: 'PRY-0001',
    name: 'Sitio Kairós',
    summary: 'Sitio corporativo',
    description: null,
    descriptionText: null,
    status: 'PROPUESTA',
    startDate: null,
    targetEndDate: null,
    endDate: null,
    clients: [
      { clientId: KAIROS, role: 'Contratante', linkedAt: new Date('2026-01-01T00:00:00Z') },
    ],
    technologyIds: [],
    links: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    ...over,
  };
}

/**
 * Every in-memory port of the projects slice, wired with the real use cases, the real permission matrix
 * and the real `TagAssignments`. `Owner`/`Admin` see money; `Member` reads and updates; `Viewer` reads.
 */
export function projectWorld() {
  const clock = new FixedClock('2026-03-10T15:00:00.000Z');
  const uow = new InMemoryUnitOfWork();
  const metrics = new InMemoryClientMetricsWriter(uow);
  const activity = new InMemoryActivityLog(uow, { metrics, now: () => clock.now() });
  const searchIndex = new InMemorySearchIndex(uow);
  const sequence = new InMemorySequence(uow);
  const projects = new InMemoryProjectRepository(uow);
  const billing = new FakeProjectBilling();
  const catalog = new FakeTechnologyCatalog(NEXT_JS, RUST, REACT);
  const authorization = new MatrixAuthorization();
  const ids = new SequentialIdGenerator('id');

  const assignmentRepo = new InMemoryTagAssignmentRepository(uow);
  const tagRepo = new InMemoryTagRepository(uow, assignmentRepo);
  const tags = new TagAssignments(tagRepo, assignmentRepo);

  for (const [id, label] of [
    [KAIROS, 'Kairós'],
    [TORNILLO, 'Tornillo'],
  ] as const) {
    projects.addClient(id, label);
    metrics.addClient(id);
  }
  projects.addClient(ARCHIVED_CLIENT, 'Viejo', { archived: true });

  const references = new ProjectReferences(projects, catalog);
  const sync = new ProjectSync(projects, searchIndex, metrics, activity);
  const views = new ProjectViews(authorization, projects, catalog, tags, billing);

  return {
    clock,
    uow,
    metrics,
    activity,
    searchIndex,
    sequence,
    projects,
    billing,
    catalog,
    authorization,
    ids,
    tags,
    tagRepo,
    assignmentRepo,
    seedTag(id: string, name: string, color = '#112233') {
      tagRepo.seed({ id, name, color, createdAt: new Date('2026-01-01T00:00:00Z') });
    },
    listProjects: new ListProjects(authorization, projects, views),
    getProject: new GetProject(authorization, projects, views),
    createProject: new CreateProject(
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
    updateProject: new UpdateProject(
      authorization,
      uow,
      projects,
      references,
      sync,
      views,
      tags,
      clock,
    ),
    setProjectClients: new SetProjectClients(
      authorization,
      uow,
      projects,
      references,
      sync,
      views,
      clock,
    ),
    setProjectTechnologies: new SetProjectTechnologies(
      authorization,
      uow,
      projects,
      references,
      sync,
      views,
    ),
    upsertProjectLinks: new UpsertProjectLinks(authorization, uow, projects, sync, ids),
    reorderProjectLinks: new ReorderProjectLinks(authorization, uow, projects, sync),
    removeProjectLink: new RemoveProjectLink(authorization, uow, projects, sync),
    setProjectStatus: new SetProjectStatus(authorization, uow, projects, billing, sync, views),
    archiveProjects: new ArchiveProjects(
      authorization,
      uow,
      projects,
      billing,
      sync,
      searchIndex,
      clock,
    ),
    restoreProject: new RestoreProject(authorization, uow, projects, sync, clock),
  };
}

export type ProjectWorld = ReturnType<typeof projectWorld>;
export { NEXT_JS, REACT, RUST };
