import type { PrismaClient } from '../../../src/generated/prisma/client';
import { PrismaSearchIndexMaintenance } from '../../../src/modules/intelligence/infrastructure/prisma-search-read-maintenance';
import { ReindexAll } from '../../../src/modules/intelligence/application/use-cases/search/reindex-all.use-case';
import { ReindexEntity } from '../../../src/modules/intelligence/application/use-cases/search/reindex-entity.use-case';
import type { SearchIndexMaintenancePort } from '../../../src/modules/intelligence/application/ports/search-read.port';
import type { SearchIndexEntry } from '../../../src/shared/application/ports/search-index.port';
import {
  SearchReindexRegistry,
  type SearchReindexSource,
} from '../../../src/shared/application/ports/search-reindex.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';

// The deterministic interleaving helpers of BE-2 (`Gate`, `gated`, `interleave`), re-exported for the specs
// of this context. This file does not import another package's world.
export { Gate, gated, interleave } from '../../commercial/concurrency/world';

export interface Hooks {
  /** Decorates the unit of work, e.g. to force `ReadCommitted` (the unfixed behavior of the RED run). */
  uow?: (uow: UnitOfWorkPort) => UnitOfWorkPort;
  /** Decorates the maintenance port, e.g. to pause a transaction after it compared an entry. */
  maintenance?: (port: SearchIndexMaintenancePort) => SearchIndexMaintenancePort;
}

/**
 * Stand-in for the client source package 4.2 registers: the entry of a client is its trade name, read
 * through the ambient transaction so that the reindex sees the snapshot of its own unit of work.
 */
export class ClientSource implements SearchReindexSource {
  readonly entityType = 'CLIENT' as const;
  constructor(private readonly host: TransactionHost) {}

  async pageIds(afterId: string | null, take: number): Promise<string[]> {
    const rows = await this.host.db.client.findMany({
      where: afterId === null ? {} : { id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const row = await this.host.db.client.findUnique({ where: { id } });
    if (!row) return null;
    return {
      entityType: 'CLIENT',
      entityId: row.id,
      code: row.code,
      title: row.tradeName,
      subtitle: row.legalName !== row.tradeName ? row.legalName : null,
      body: null,
      status: row.status,
      archived: false,
    };
  }
}

/** The reindex use cases over real adapters sharing one host, plus a rename shaped like `UpdateClient`. */
export function buildWorld(service: PrismaService, hooks: Hooks = {}) {
  const host = new TransactionHost(service);
  const uow = (hooks.uow ?? ((u) => u))(new PrismaUnitOfWork(host));
  const searchIndex = new PrismaSearchIndex(host);
  const maintenance = (hooks.maintenance ?? ((m) => m))(new PrismaSearchIndexMaintenance(host));
  const registry = new SearchReindexRegistry();
  registry.register(new ClientSource(host));
  return {
    host,
    reindexEntity: new ReindexEntity(uow, registry, searchIndex, maintenance),
    reindexAll: new ReindexAll(uow, registry, searchIndex, maintenance),
    /** The shape of a rename's unit of work: the row and its entry change together, `Serializable` (DT-166). */
    renameClient: (id: string, tradeName: string) =>
      new PrismaUnitOfWork(host).run(
        async () => {
          const tx = host.requireTransaction('renameClient');
          const row = await tx.client.update({ where: { id }, data: { tradeName } });
          await searchIndex.upsert({
            entityType: 'CLIENT',
            entityId: id,
            code: row.code,
            title: tradeName,
            subtitle: row.legalName !== tradeName ? row.legalName : null,
            body: null,
            status: row.status,
            archived: false,
          });
        },
        { isolation: 'Serializable' },
      ),
  };
}

export type World = ReturnType<typeof buildWorld>;

/** Seeds a client and its (optionally stale) search entry. */
export async function seedIndexedClient(
  admin: PrismaClient,
  id: string,
  options: { tradeName: string; entryTitle?: string | null },
): Promise<void> {
  const client = await admin.client.findUniqueOrThrow({ where: { id } });
  await admin.client.update({ where: { id }, data: { tradeName: options.tradeName } });
  if (options.entryTitle === null) return;
  await admin.searchEntry.create({
    data: {
      entityType: 'CLIENT',
      entityId: id,
      code: client.code,
      title: options.entryTitle ?? options.tradeName,
      subtitle: client.legalName,
      status: client.status,
    },
  });
}
