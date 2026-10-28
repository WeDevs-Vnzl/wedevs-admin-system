import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../../shared/domain/domain-error';
import type { ListQuery } from '../../../shared/domain/list-query';
import { paginated, pageWindow, type Paginated } from '../../../shared/domain/pagination';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { searchCondition } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import type { TagRepository } from '../application/ports/tag.repository.port';
import {
  TAG_NAME_TAKEN_KEY,
  isTaggableEntityType,
  type Tag,
  type TagWithUsage,
  type TaggableEntityType,
} from '../domain/tag';

/** `TagAssignment` column that holds each taggable entity type (PRD §10.2, `tag_one_target`). */
export const TARGET_COLUMN: Record<TaggableEntityType, string> = {
  CLIENT: 'clientId',
  CONTACT: 'contactId',
  PROJECT: 'projectId',
  INVOICE: 'invoiceId',
  PAYMENT: 'paymentId',
  EXPENSE: 'expenseId',
  DOCUMENT: 'documentId',
  NOTE: 'noteId',
};

/** Target table of each column, joined read-only to leave archived records out of the usage count. */
const TARGET_TABLES = [
  ['Client', 'clientId'],
  ['Contact', 'contactId'],
  ['Project', 'projectId'],
  ['Invoice', 'invoiceId'],
  ['Payment', 'paymentId'],
  ['Expense', 'expenseId'],
  ['Document', 'documentId'],
  ['Note', 'noteId'],
] as const;

/** Sort expressions (trusted constants, never user text). */
const NAME_SORT = Prisma.sql`lower(t."name")`;
const SORT_SQL: Record<string, Prisma.Sql> = {
  name: NAME_SORT,
  usageCount: Prisma.sql`COALESCE(u."n", 0)`,
  createdAt: Prisma.sql`t."createdAt"`,
};

interface TagRow {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
  usageCount?: number;
}

const toTag = (row: TagRow): Tag => ({
  id: row.id,
  name: row.name,
  color: row.color,
  createdAt: row.createdAt,
});

/**
 * Usage per tag: assignments whose target is not archived (the mock's `tagUsage`). **Documented
 * cross-context read:** the statement left-joins the eight target tables read-only, only for their
 * `deletedAt`, like the trash read port; settings owns no write path to them. `types` limits the count
 * to those entity types; `tagId` limits it to one tag.
 */
function usageSql(types?: readonly TaggableEntityType[], tagId?: string): Prisma.Sql {
  const joins = TARGET_TABLES.map(
    ([table, column], i) =>
      Prisma.sql`LEFT JOIN ${Prisma.raw(`"${table}"`)} ${Prisma.raw(`x${i}`)} ON ${Prisma.raw(`x${i}`)}."id" = ta.${Prisma.raw(`"${column}"`)}`,
  );
  const conditions: Prisma.Sql[] = TARGET_TABLES.map(
    (_, i) => Prisma.sql`${Prisma.raw(`x${i}`)}."deletedAt" IS NULL`,
  );
  if (types) {
    conditions.push(
      Prisma.sql`(${Prisma.join(
        types.map((type) => Prisma.sql`ta.${Prisma.raw(`"${TARGET_COLUMN[type]}"`)} IS NOT NULL`),
        ' OR ',
      )})`,
    );
  }
  if (tagId !== undefined) conditions.push(Prisma.sql`ta."tagId" = ${tagId}`);
  return Prisma.sql`SELECT ta."tagId" AS "tagId", count(*)::int AS "n" FROM "TagAssignment" ta ${Prisma.join(joins, ' ')} WHERE ${Prisma.join(conditions, ' AND ')} GROUP BY ta."tagId"`;
}

function entityTypesOf(query: ListQuery): TaggableEntityType[] | undefined {
  const raw = query.filters.entityType;
  if (raw === undefined) return undefined;
  const values = (Array.isArray(raw) ? raw : [raw]).filter(isTaggableEntityType);
  return values.length > 0 ? values : undefined;
}

/** `Tag` rows through the current transaction (or the base client outside a unit of work). */
@Injectable()
export class PrismaTagRepository implements TagRepository {
  constructor(private readonly host: TransactionHost) {}

  async list(query: ListQuery): Promise<Paginated<TagWithUsage>> {
    const db = this.host.db;
    const types = entityTypesOf(query);
    const usage = usageSql(types);
    const search = searchCondition(['name'], query.q);
    const where: Prisma.Sql[] = [];
    if (types) where.push(Prisma.sql`COALESCE(u."n", 0) > 0`);
    if (search) where.push(Prisma.sql`(${search})`);
    const whereSql =
      where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;

    const sort = query.sort ?? { field: 'name', direction: 'asc' as const };
    const expression = SORT_SQL[sort.field] ?? NAME_SORT;
    const direction = Prisma.raw(sort.direction === 'desc' ? 'DESC' : 'ASC');
    const { skip, take } = pageWindow(query.page, query.pageSize);

    const rows = await db.$queryRaw<TagRow[]>`
      SELECT t."id", t."name", t."color", t."createdAt", COALESCE(u."n", 0)::int AS "usageCount"
      FROM "Tag" t LEFT JOIN (${usage}) u ON u."tagId" = t."id"
      ${whereSql}
      ORDER BY ${expression} ${direction}, t."id" ASC
      LIMIT ${take} OFFSET ${skip}`;
    const totals = await db.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS "total"
      FROM "Tag" t LEFT JOIN (${usage}) u ON u."tagId" = t."id"
      ${whereSql}`;
    return paginated(
      rows.map((row) => ({ ...toTag(row), usageCount: row.usageCount ?? 0 })),
      totals[0]?.total ?? 0,
      query,
    );
  }

  async findWithUsage(id: string): Promise<TagWithUsage | null> {
    const db = this.host.db;
    const row = await db.tag.findUnique({ where: { id } });
    if (!row) return null;
    const usage = await db.$queryRaw<{ n: number }[]>(usageSql(undefined, id));
    return { ...toTag(row), usageCount: usage[0]?.n ?? 0 };
  }

  async find(id: string): Promise<Tag | null> {
    const row = await this.host.db.tag.findUnique({ where: { id } });
    return row ? toTag(row) : null;
  }

  async findByName(name: string): Promise<Tag | null> {
    const row = await this.host.db.tag.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    return row ? toTag(row) : null;
  }

  async findManyByIds(ids: readonly string[]): Promise<Tag[]> {
    if (ids.length === 0) return [];
    const rows = await this.host.db.tag.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toTag);
  }

  async insert(tag: Tag): Promise<void> {
    const tx = this.host.requireTransaction('TagRepository.insert');
    try {
      await tx.tag.create({
        data: { id: tag.id, name: tag.name, color: tag.color, createdAt: tag.createdAt },
      });
    } catch (error) {
      throw nameTakenOrRethrow(error);
    }
  }

  async update(tag: Tag): Promise<void> {
    const tx = this.host.requireTransaction('TagRepository.update');
    try {
      await tx.tag.update({ where: { id: tag.id }, data: { name: tag.name, color: tag.color } });
    } catch (error) {
      throw nameTakenOrRethrow(error);
    }
  }
}

/** Lost race on the `name` unique: the same `CONFLICT` the use case raises (the holder is unknown here). */
function nameTakenOrRethrow(error: unknown): unknown {
  return isUniqueViolation(error)
    ? new ConflictError({ fieldErrors: { name: [TAG_NAME_TAKEN_KEY] } })
    : error;
}
