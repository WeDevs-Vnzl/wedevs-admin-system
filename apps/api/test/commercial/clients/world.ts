import { ArchiveClients } from '../../../src/modules/commercial/application/use-cases/archive-clients.use-case';
import { ArchiveContact } from '../../../src/modules/commercial/application/use-cases/archive-contact.use-case';
import { CreateClient } from '../../../src/modules/commercial/application/use-cases/create-client.use-case';
import { CreateContact } from '../../../src/modules/commercial/application/use-cases/create-contact.use-case';
import { GetClient } from '../../../src/modules/commercial/application/use-cases/get-client.use-case';
import { ListClients } from '../../../src/modules/commercial/application/use-cases/list-clients.use-case';
import { ListContacts } from '../../../src/modules/commercial/application/use-cases/list-contacts.use-case';
import { ProjectSync } from '../../../src/modules/commercial/application/use-cases/project-sync';
import type { ClientSearchDependentsPort } from '../../../src/modules/commercial/application/ports/client-search-dependents.port';
import { RestoreClient } from '../../../src/modules/commercial/application/use-cases/restore-client.use-case';
import { RestoreContact } from '../../../src/modules/commercial/application/use-cases/restore-contact.use-case';
import { SearchClients } from '../../../src/modules/commercial/application/use-cases/search-clients.use-case';
import { SearchContacts } from '../../../src/modules/commercial/application/use-cases/search-contacts.use-case';
import { SetClientStatus } from '../../../src/modules/commercial/application/use-cases/set-client-status.use-case';
import { SetPrimaryContact } from '../../../src/modules/commercial/application/use-cases/set-primary-contact.use-case';
import { UpdateClient } from '../../../src/modules/commercial/application/use-cases/update-client.use-case';
import { UpdateContact } from '../../../src/modules/commercial/application/use-cases/update-contact.use-case';
import type { ClientInput } from '../../../src/modules/commercial/domain/client';
import type { ContactInput } from '../../../src/modules/commercial/domain/contact';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import type { Tag } from '../../../src/modules/settings/domain/tag';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryClientMetricsWriter } from '../../support/fakes/in-memory-client-metrics-writer';
import { InMemorySearchIndex } from '../../support/fakes/in-memory-search-index';
import { InMemorySequence } from '../../support/fakes/in-memory-sequence';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryTagAssignmentRepository, InMemoryTagRepository } from '../../settings/tags/fakes';
import { InMemoryProjectRepository } from '../projects/fakes/in-memory-project.repository';
import { FakeClientFinanceDependents } from './fakes/fake-client-finance-dependents';
import { InMemoryClientRepository } from './fakes/in-memory-client.repository';
import { InMemoryContactRepository } from './fakes/in-memory-contact.repository';
import { STAMP, clientRecord, contactRecord, userOf } from './fixtures';

export { userOf } from './fixtures';

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

/** A valid client form; override what a test cares about. */
export const clientInput = (over: Partial<ClientInput> = {}): ClientInput => ({
  kind: 'EMPRESA',
  tradeName: 'Nube Austral',
  legalName: 'Nube Austral C.A.',
  taxId: 'J-40111222-3',
  country: 'VE',
  address: 'Av. Principal, Caracas',
  phone: '+584121234567',
  ...over,
});

export const contactInput = (over: Partial<ContactInput> = {}): ContactInput => ({
  fullName: 'Ana Pérez',
  email: 'ana@kairos.example.com',
  ...over,
});

/** The `index`-th item of a list the test knows is long enough (no non-null assertions). */
export function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an item at index ${index}`);
  return item;
}

/** Rejection of a promise as the error it threw (fails when it resolves). */
export async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as {
      code: string;
      message: string;
      fieldErrors?: Record<string, string[]>;
      entity?: { id: string; type: string; code?: string; label: string };
    };
  }
  throw new Error('expected the promise to reject');
}

/** Records the relabels a rename asked for; `log` is shared with the other fakes to assert the order. */
export class FakeClientSearchDependents implements ClientSearchDependentsPort {
  readonly calls: { clientId: string; label: string }[] = [];

  constructor(private readonly log: string[]) {}

  async relabelClient(clientId: string, label: string): Promise<number> {
    this.log.push('relabelClient');
    this.calls.push({ clientId, label });
    return 0;
  }
}

/** Every in-memory port of the clients and contacts slice, wired with the real use cases and matrix. */
export function createWorld() {
  const clock = new FixedClock(STAMP);
  const uow = new InMemoryUnitOfWork();
  const metrics = new InMemoryClientMetricsWriter(uow);
  const activity = new InMemoryActivityLog(uow, { metrics, now: () => clock.now() });
  const search = new InMemorySearchIndex(uow);
  const sequence = new InMemorySequence(uow);
  const authorization = new MatrixAuthorization();
  const clients = new InMemoryClientRepository(uow);
  const contacts = new InMemoryContactRepository(uow, clients);
  const finance = new FakeClientFinanceDependents();
  const assignmentRepo = new InMemoryTagAssignmentRepository(uow);
  const tagRepo = new InMemoryTagRepository(uow, assignmentRepo);
  const assignments = new TagAssignments(tagRepo, assignmentRepo);
  const ids = new SequentialIdGenerator('id');
  const rowLocks = new InMemoryRowLocks(uow);
  const projects = new InMemoryProjectRepository(uow);
  const sync = new ProjectSync(projects, search, metrics, activity);
  const order: string[] = [];
  const dependents = new FakeClientSearchDependents(order);

  const world = {
    clock,
    uow,
    metrics,
    activity,
    search,
    sequence,
    authorization,
    clients,
    contacts,
    finance,
    rowLocks,
    projects,
    sync,
    dependents,
    order,
    assignmentRepo,
    tagRepo,
    assignments,
    createClient: new CreateClient(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activity,
      search,
      metrics,
      sequence,
      clock,
      ids,
    ),
    updateClient: new UpdateClient(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activity,
      search,
      clock,
      rowLocks,
      projects,
      sync,
      dependents,
    ),
    setClientStatus: new SetClientStatus(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activity,
      search,
      clock,
    ),
    archiveClients: new ArchiveClients(
      authorization,
      uow,
      clients,
      contacts,
      finance,
      activity,
      search,
      clock,
    ),
    restoreClient: new RestoreClient(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activity,
      search,
      clock,
    ),
    listClients: new ListClients(authorization, clients, assignments),
    getClient: new GetClient(authorization, clients, contacts, assignments),
    searchClients: new SearchClients(authorization, clients),
    createContact: new CreateContact(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activity,
      search,
      clock,
      ids,
    ),
    updateContact: new UpdateContact(
      authorization,
      uow,
      contacts,
      assignments,
      activity,
      search,
      clock,
    ),
    setPrimaryContact: new SetPrimaryContact(
      authorization,
      uow,
      contacts,
      assignments,
      activity,
      clock,
    ),
    archiveContact: new ArchiveContact(authorization, uow, contacts, activity, search, clock),
    restoreContact: new RestoreContact(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activity,
      search,
      clock,
    ),
    listContacts: new ListContacts(authorization, clients, contacts, assignments),
    searchContacts: new SearchContacts(authorization, contacts),
    owner: userOf('OWNER'),
    admin: userOf('ADMIN'),
    member: userOf('MEMBER'),
    viewer: userOf('VIEWER'),

    /** A committed live client, with `n` committed live contacts when asked. */
    seedClient(over: Parameters<typeof clientRecord>[0] = {}, contactCount = 0) {
      const client = clients.seed(clientRecord(over));
      metrics.addClient(client.id);
      const seeded = Array.from({ length: contactCount }, () =>
        contacts.seed(contactRecord(client.id)),
      );
      return { client, contacts: seeded };
    },
    seedTag(id: string, name: string, color = '#112233'): Tag {
      const tag: Tag = { id, name, color, createdAt: new Date(STAMP) };
      tagRepo.seed(tag);
      return tag;
    },
  };
  return world;
}
export type World = ReturnType<typeof createWorld>;
