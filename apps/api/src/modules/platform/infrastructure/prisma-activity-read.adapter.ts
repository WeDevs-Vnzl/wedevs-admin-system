import { Inject, Injectable } from '@nestjs/common';
import type {
  ActivityChanges,
  ActivityListCriteria,
  ActivityMetadata,
  ActivityReadPort,
  ActivityRecord,
  ActivitySortField,
} from '../application/ports/activity-read.port';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { escapeLike } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

const SORT_COLUMN: Record<ActivitySortField, Prisma.Sql> = {
  createdAt: Prisma.sql`a."createdAt"`,
  action: Prisma.sql`a."action"::text`,
  entityType: Prisma.sql`a."entityType"::text`,
};

// One statement shape for the page ids and the count: `User` is joined for the search and the actor.
const FROM = Prisma.sql`FROM "ActivityLog" a LEFT JOIN "User" u ON u."id" = a."actorId"`;

/** The `WHERE` body: every filter as a parameterized predicate; `TRUE` when there is none. */
function whereOf(c: ActivityListCriteria): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (c.actorIds.length > 0) {
    parts.push(Prisma.sql`a."actorId" IN (${Prisma.join([...c.actorIds])})`);
  }
  if (c.actorTypes.length > 0) {
    parts.push(Prisma.sql`a."actorType"::text IN (${Prisma.join([...c.actorTypes])})`);
  }
  if (c.actions.length > 0) {
    parts.push(Prisma.sql`a."action"::text IN (${Prisma.join([...c.actions])})`);
  }
  if (c.entityTypes.length > 0) {
    parts.push(Prisma.sql`a."entityType"::text IN (${Prisma.join([...c.entityTypes])})`);
  }
  if (c.entityId !== null) parts.push(Prisma.sql`a."entityId" = ${c.entityId}`);
  if (c.createdFrom) parts.push(Prisma.sql`a."createdAt" >= ${c.createdFrom}`);
  if (c.createdBefore) parts.push(Prisma.sql`a."createdAt" < ${c.createdBefore}`);
  const text = c.search?.trim();
  if (text) {
    // Accent-folded, case-insensitive contains over the label and the actor's name (data-rules.md §7).
    const pattern = Prisma.sql`'%' || unaccent(lower(${escapeLike(text)})) || '%'`;
    parts.push(
      Prisma.sql`(unaccent(lower(a."entityLabel")) LIKE ${pattern} ESCAPE '\\'
        OR unaccent(lower(COALESCE(u."name", ''))) LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

interface HydratedRow {
  id: string;
  actorType: ActivityRecord['actorType'];
  actorId: string | null;
  action: ActivityRecord['action'];
  entityType: ActivityRecord['entityType'];
  entityId: string;
  entityLabel: string;
  changes: unknown;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  actor: { name: string; imageUrl: string | null } | null;
}

function toRecord(row: HydratedRow): ActivityRecord {
  return {
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    actorImageUrl: row.actor?.imageUrl ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    // Written by the activity writer (shared, C20): trusted as stored.
    changes: (row.changes as ActivityChanges | null) ?? null,
    metadata: (row.metadata as ActivityMetadata | null) ?? null,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

/**
 * Read adapter over `ActivityLog` (C20: read only). Three bounded statements per page: the page ids
 * (filters, search, sort and page in SQL), the count over the same predicate, and one hydrate of at most
 * `pageSize` rows with their actor, put back in SQL order.
 */
@Injectable()
export class PrismaActivityReadAdapter implements ActivityReadPort {
  constructor(@Inject(TransactionHost) private readonly tx: TransactionHost) {}

  async list(criteria: ActivityListCriteria): Promise<Paginated<ActivityRecord>> {
    const db = this.tx.db;
    const where = whereOf(criteria);
    const { skip, take } = pageWindow(criteria.page, criteria.pageSize);
    const direction = Prisma.raw(criteria.sort.direction === 'desc' ? 'DESC' : 'ASC');
    const order = Prisma.sql`${SORT_COLUMN[criteria.sort.field]} ${direction}, a."id" ASC`;

    const pageRows = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT a."id" ${FROM} WHERE ${where} ORDER BY ${order} LIMIT ${take} OFFSET ${skip}`,
    );
    const countRows = await db.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int AS "total" ${FROM} WHERE ${where}`,
    );
    const total = countRows[0]?.total ?? 0;

    const ids = pageRows.map((row) => row.id);
    const rows =
      ids.length === 0
        ? []
        : await db.activityLog.findMany({
            where: { id: { in: ids } },
            include: { actor: { select: { name: true, imageUrl: true } } },
          });
    const position = new Map(ids.map((id, index) => [id, index]));
    const items = [...rows]
      .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
      .map((row) => toRecord(row as unknown as HydratedRow));
    return paginated(items, total, { page: criteria.page, pageSize: criteria.pageSize });
  }
}
