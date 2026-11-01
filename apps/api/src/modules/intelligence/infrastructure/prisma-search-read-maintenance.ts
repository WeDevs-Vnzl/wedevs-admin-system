import { Injectable } from '@nestjs/common';
import type { SearchIndexEntry } from '../../../shared/application/ports/search-index.port';
import type { EntityType } from '../../../shared/domain/enums';
import { truncateBody } from '../../../shared/infrastructure/prisma/prisma-search-index';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  EntryComparison,
  SearchIndexMaintenancePort,
} from '../application/ports/search-read.port';

/** Same NUL stripping as `PrismaSearchIndex.upsert`, so both sides of a comparison are normalized alike. */
const clean = (value: string): string => value.replaceAll('\u0000', '');
const cleanOrNull = (value: string | null): string | null => (value === null ? null : clean(value));

/** What `PrismaSearchIndex.upsert` would store for `entry`. */
function normalized(entry: SearchIndexEntry) {
  return {
    code: cleanOrNull(entry.code),
    title: clean(entry.title),
    subtitle: cleanOrNull(entry.subtitle),
    body: entry.body === null ? null : truncateBody(clean(entry.body)),
    status: entry.status,
    archived: entry.archived,
  };
}

/** Compare, list and delete over `SearchEntry` for the repair (`SearchIndexPort` has no delete). */
@Injectable()
export class PrismaSearchIndexMaintenance implements SearchIndexMaintenancePort {
  constructor(private readonly host: TransactionHost) {}

  async compare(entry: SearchIndexEntry): Promise<EntryComparison> {
    const stored = await this.host.db.searchEntry.findUnique({
      where: { entityType_entityId: { entityType: entry.entityType, entityId: entry.entityId } },
      select: {
        code: true,
        title: true,
        subtitle: true,
        body: true,
        status: true,
        archived: true,
      },
    });
    if (!stored) return 'missing';
    const wanted = normalized(entry);
    const same =
      stored.code === wanted.code &&
      stored.title === wanted.title &&
      stored.subtitle === wanted.subtitle &&
      stored.body === wanted.body &&
      stored.status === wanted.status &&
      stored.archived === wanted.archived;
    return same ? 'same' : 'different';
  }

  async listEntityIds(
    entityType: EntityType,
    afterId: string | null,
    take: number,
  ): Promise<string[]> {
    const rows = await this.host.db.searchEntry.findMany({
      where: { entityType, ...(afterId === null ? {} : { entityId: { gt: afterId } }) },
      orderBy: { entityId: 'asc' },
      take,
      select: { entityId: true },
    });
    return rows.map((row) => row.entityId);
  }

  async remove(entityType: EntityType, entityId: string): Promise<boolean> {
    const tx = this.host.requireTransaction('SearchIndexMaintenancePort.remove');
    const { count } = await tx.searchEntry.deleteMany({ where: { entityType, entityId } });
    return count > 0;
  }
}
