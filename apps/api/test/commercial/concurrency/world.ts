import { ArchiveClients } from '../../../src/modules/commercial/application/use-cases/archive-clients.use-case';
import { CreateContact } from '../../../src/modules/commercial/application/use-cases/create-contact.use-case';
import { CreateProject } from '../../../src/modules/commercial/application/use-cases/create-project.use-case';
import { ProjectReferences } from '../../../src/modules/commercial/application/use-cases/project-references';
import { ProjectSync } from '../../../src/modules/commercial/application/use-cases/project-sync';
import { ProjectViews } from '../../../src/modules/commercial/application/use-cases/project-views';
import { RestoreClient } from '../../../src/modules/commercial/application/use-cases/restore-client.use-case';
import { RestoreContact } from '../../../src/modules/commercial/application/use-cases/restore-contact.use-case';
import { SetProjectClients } from '../../../src/modules/commercial/application/use-cases/set-project-clients.use-case';
import { SetProjectStatus } from '../../../src/modules/commercial/application/use-cases/set-project-status.use-case';
import { UpdateProject } from '../../../src/modules/commercial/application/use-cases/update-project.use-case';
import { UpsertProjectLinks } from '../../../src/modules/commercial/application/use-cases/upsert-project-links.use-case';
import type { ClientRepository } from '../../../src/modules/commercial/application/ports/client.repository.port';
import type { ContactRepository } from '../../../src/modules/commercial/application/ports/contact.repository.port';
import type { ProjectRepository } from '../../../src/modules/commercial/application/ports/project.repository.port';
import { PrismaClientRepository } from '../../../src/modules/commercial/infrastructure/prisma-client.repository';
import { PrismaContactRepository } from '../../../src/modules/commercial/infrastructure/prisma-contact.repository';
import { PrismaProjectRepository } from '../../../src/modules/commercial/infrastructure/prisma-project.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import { PrismaTagAssignmentRepository } from '../../../src/modules/settings/infrastructure/prisma-tag-assignment.repository';
import { PrismaTagRepository } from '../../../src/modules/settings/infrastructure/prisma-tag.repository';
import type { ClientMetricsWriterPort } from '../../../src/shared/application/ports/client-metrics-writer.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaSequence } from '../../../src/shared/infrastructure/prisma/prisma-sequence';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { FakeProjectBilling } from '../projects/fakes/fake-project-billing';
import { FakeTechnologyCatalog } from '../projects/fakes/fake-technology-catalog';
import { userOf } from '../clients/fixtures';

/** A pause point: the transaction under test stops there until the test releases it. */
export class Gate {
  readonly arrived: Promise<void>;
  private markArrived!: () => void;
  private readonly released: Promise<void>;
  private release_!: () => void;
  private used = false;

  constructor() {
    this.arrived = new Promise((resolve) => (this.markArrived = resolve));
    this.released = new Promise((resolve) => (this.release_ = resolve));
  }

  /** Only the first call pauses. */
  async pause(): Promise<void> {
    if (this.used) return;
    this.used = true;
    this.markArrived();
    await this.released;
  }

  release(): void {
    this.release_();
  }
}

/**
 * Wraps `target` so that calling any of `methods` pauses at `gate` before (or after) the real call.
 * Methods the target does not have are ignored, so one hook serves the code before and after a fix.
 */
export function gated<T extends object>(
  target: T,
  gate: Gate,
  methods: readonly string[],
  when: 'before' | 'after' = 'before',
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value: unknown = Reflect.get(obj, prop, receiver);
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(obj);
      if (typeof prop !== 'string' || !methods.includes(prop)) return bound;
      return async (...args: unknown[]) => {
        if (when === 'before') await gate.pause();
        const result = await bound(...args);
        if (when === 'after') await gate.pause();
        return result;
      };
    },
  });
}

export interface Hooks {
  projects?: (repo: ProjectRepository) => ProjectRepository;
  clients?: (repo: ClientRepository) => ClientRepository;
  contacts?: (repo: ContactRepository) => ContactRepository;
  metrics?: (writer: ClientMetricsWriterPort) => ClientMetricsWriterPort;
}

/** The commercial use cases over real repositories; `hooks` decorate a repository for one transaction under test. */
export function buildWorld(service: PrismaService, hooks: Hooks = {}) {
  const host = new TransactionHost(service);
  const uow = new PrismaUnitOfWork(host);
  const authorization = new MatrixAuthorization();
  const clock = new SystemClock();
  const ids = new CuidGenerator();
  const projects = (hooks.projects ?? ((r) => r))(new PrismaProjectRepository(host));
  const clients = (hooks.clients ?? ((r) => r))(new PrismaClientRepository(host));
  const contacts = (hooks.contacts ?? ((r) => r))(new PrismaContactRepository(host));
  const metrics = (hooks.metrics ?? ((m) => m))(new PrismaClientMetricsWriter(host));
  const activityLog = new PrismaActivityLog(host, new PrismaClientMetricsWriter(host));
  const searchIndex = new PrismaSearchIndex(host);
  const sequence = new PrismaSequence(host);
  const assignments = new TagAssignments(
    new PrismaTagRepository(host),
    new PrismaTagAssignmentRepository(host),
  );
  const billing = new FakeProjectBilling();
  const catalog = new FakeTechnologyCatalog();
  const references = new ProjectReferences(projects, catalog);
  const sync = new ProjectSync(projects, searchIndex, metrics, activityLog);
  const views = new ProjectViews(authorization, projects, catalog, assignments, billing);

  return {
    archiveClients: new ArchiveClients(
      authorization,
      uow,
      clients,
      contacts,
      { hasOpenInvoices: async () => false },
      activityLog,
      searchIndex,
      clock,
    ),
    restoreClient: new RestoreClient(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activityLog,
      searchIndex,
      clock,
    ),
    createContact: new CreateContact(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activityLog,
      searchIndex,
      clock,
      ids,
    ),
    restoreContact: new RestoreContact(
      authorization,
      uow,
      clients,
      contacts,
      assignments,
      activityLog,
      searchIndex,
      clock,
    ),
    createProject: new CreateProject(
      authorization,
      uow,
      projects,
      references,
      sync,
      views,
      assignments,
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
      assignments,
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
    setProjectStatus: new SetProjectStatus(authorization, uow, projects, billing, sync, views),
    upsertProjectLinks: new UpsertProjectLinks(authorization, uow, projects, sync, ids),
  };
}

/** The activity entry references the actor, so the caller must exist as a user. */
export async function ownerOf(admin: PrismaClient) {
  const row = await admin.user.create({
    data: { clerkId: 'user_owner', email: 'owner@example.test', name: 'Owner', role: 'OWNER' },
  });
  return { ...userOf('OWNER'), userId: row.id };
}

let seq = 0;
export async function seedClient(admin: PrismaClient, id: string) {
  seq += 1;
  return admin.client.create({
    data: {
      id,
      code: `CLI-${String(seq).padStart(4, '0')}`,
      kind: 'EMPRESA',
      tradeName: `Cliente ${id}`,
      legalName: `Cliente ${id} C.A.`,
      taxId: `J-5${String(seq).padStart(7, '0')}-1`,
      country: 'VE',
      address: 'Av. Principal',
      phone: '+584121234567',
      metrics: { create: {} },
    },
  });
}

export async function seedProject(
  admin: PrismaClient,
  id: string,
  clientIds: readonly string[],
  status: 'PROPUESTA' | 'EN_CURSO' = 'PROPUESTA',
) {
  seq += 1;
  return admin.project.create({
    data: {
      id,
      code: `PRY-9${String(seq).padStart(3, '0')}`,
      name: `Proyecto ${id}`,
      summary: 'Resumen',
      status,
      startDate: status === 'EN_CURSO' ? new Date('2026-01-01') : null,
      clients: { create: clientIds.map((clientId) => ({ clientId })) },
    },
  });
}

/**
 * Runs `first` until `gate` is reached, then `second` to completion or until it blocks on a row lock held
 * by `first` (read from `pg_stat_activity`, so no sleeps), then lets `first` go on. Returns both outcomes.
 */
export async function interleave(
  admin: PrismaClient,
  gate: Gate,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  const p1 = first();
  p1.catch(() => undefined);
  await Promise.race([
    gate.arrived,
    p1.then(
      () => undefined,
      () => undefined,
    ),
  ]);
  let secondDone = false;
  const p2 = second();
  p2.then(
    () => (secondDone = true),
    () => (secondDone = true),
  );
  const deadline = Date.now() + 10_000;
  while (!secondDone && Date.now() < deadline) {
    const rows = await admin.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((rows[0]?.waiting ?? 0) > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  gate.release();
  const [one, two] = await Promise.allSettled([p1, p2]);
  return [one as PromiseSettledResult<unknown>, two as PromiseSettledResult<unknown>];
}
