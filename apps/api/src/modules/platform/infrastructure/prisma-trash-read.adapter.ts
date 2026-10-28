import { Injectable } from '@nestjs/common';
import { BUSINESS_TIME_ZONE } from '../../../shared/domain/business-date';
import { paginated, pageWindow, type Paginated } from '../../../shared/domain/pagination';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { searchCondition } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { TrashableEntityType } from '../application/ports/restore-handler.port';
import type {
  TrashReadPort,
  TrashReadQuery,
  TrashRow,
  TrashSortField,
} from '../application/ports/trash-read.port';

/** First words of an untitled note (the FE `firstWords` rule), falling back to its id. */
const NOTE_LABEL_WORDS = 6;

/**
 * One SELECT per archived table, all with the same columns, named by the CTE:
 * `entityType, id, code, label, context, deletedAt, deletedById`. A type with no branch here (finance
 * types, voided or deactivated rather than archived) never has rows in the trash.
 */
const BRANCHES: Partial<Record<TrashableEntityType, Prisma.Sql>> = {
  CLIENT: Prisma.sql`
    SELECT 'CLIENT', c.id, c.code, c."tradeName", NULL::text, c."deletedAt", c."deletedById"
    FROM "Client" c WHERE c."deletedAt" IS NOT NULL`,
  CONTACT: Prisma.sql`
    SELECT 'CONTACT', k.id, NULL::text, k."fullName", cl."tradeName", k."deletedAt", NULL::text
    FROM "Contact" k JOIN "Client" cl ON cl.id = k."clientId" WHERE k."deletedAt" IS NOT NULL`,
  PROJECT: Prisma.sql`
    SELECT 'PROJECT', p.id, p.code, p.name,
           (SELECT string_agg(cl."tradeName", ', ' ORDER BY cl."tradeName")
              FROM "ProjectClient" pc JOIN "Client" cl ON cl.id = pc."clientId"
             WHERE pc."projectId" = p.id),
           p."deletedAt", p."deletedById"
    FROM "Project" p WHERE p."deletedAt" IS NOT NULL`,
  NOTE: Prisma.sql`
    SELECT 'NOTE', n.id, NULL::text,
           COALESCE(NULLIF(n.title, ''),
                    NULLIF(array_to_string((regexp_split_to_array(btrim(n."contentText"), '\\s+'))[1:${NOTE_LABEL_WORDS}], ' '), ''),
                    n.id),
           NULL::text, n."deletedAt", n."deletedById"
    FROM "Note" n WHERE n."deletedAt" IS NOT NULL`,
  INVOICE: Prisma.sql`
    SELECT 'INVOICE', i.id, i.code, i."invoiceNumber", cl."tradeName", i."deletedAt", i."deletedById"
    FROM "Invoice" i JOIN "Client" cl ON cl.id = i."clientId" WHERE i."deletedAt" IS NOT NULL`,
  DOCUMENT: Prisma.sql`
    SELECT 'DOCUMENT', d.id, d.code, d.title, dt.name, d."deletedAt", d."deletedById"
    FROM "Document" d JOIN "DocumentType" dt ON dt.id = d."typeId" WHERE d."deletedAt" IS NOT NULL`,
};

const SORT_SQL: Record<TrashSortField, Prisma.Sql> = {
  deletedAt: Prisma.sql`r."deletedAt"`,
  entityType: Prisma.sql`r."entityType"`,
  label: Prisma.sql`unaccent(lower(r.label))`,
};

interface RawRow {
  entityType: TrashableEntityType;
  id: string;
  code: string | null;
  label: string;
  context: string | null;
  deletedAt: Date;
  userId: string | null;
  userName: string | null;
  userImageUrl: string | null;
}

/**
 * Cross-context read of the trash (`backend-architecture.md` §3 aggregate rule): a `UNION ALL` over the
 * archived rows of `Client`, `Contact`, `Project`, `Note`, `Invoice` and `Document`, filtered, sorted and
 * paged in SQL (two bounded statements: count and page). Everything the caller supplies is a bound
 * parameter; the sort field and direction are picked from fixed fragments. Raw SQL bypasses the soft-delete
 * extension on purpose: the archived rows are the subject.
 */
@Injectable()
export class PrismaTrashRead implements TrashReadPort {
  constructor(private readonly tx: TransactionHost) {}

  async list(query: TrashReadQuery): Promise<Paginated<TrashRow>> {
    const branches = query.entityTypes.flatMap((type) => BRANCHES[type] ?? []);
    if (branches.length === 0) return paginated([], 0, query);

    const where = this.where(query);
    // The archiver: the stored `deletedById`, else the actor of the latest DELETE entry when it is a user
    // (`Contact` has no `deletedById`).
    const source = Prisma.sql`
      WITH archived ("entityType", id, code, label, context, "deletedAt", "deletedById") AS (
        ${Prisma.join(branches, ' UNION ALL ')}),
      resolved AS (
        SELECT a.*, COALESCE(a."deletedById", (
          SELECT CASE WHEN l."actorType" = 'USER' THEN l."actorId" END
          FROM "ActivityLog" l
          WHERE l."entityType"::text = a."entityType" AND l."entityId" = a.id AND l.action = 'DELETE'
          ORDER BY l."createdAt" DESC, l.id DESC LIMIT 1)) AS "archiverId"
        FROM archived a)`;
    const from = Prisma.sql`FROM resolved r LEFT JOIN "User" u ON u.id = r."archiverId"`;

    const counted = await this.tx.db.$queryRaw<{ total: bigint }[]>`
      ${source} SELECT count(*) AS total ${from} ${where}`;
    const total = Number(counted[0]?.total ?? 0);

    const { skip, take } = pageWindow(query.page, query.pageSize);
    const direction = query.sort.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const sort = SORT_SQL[query.sort.field as TrashSortField] ?? SORT_SQL.deletedAt;
    const rows = await this.tx.db.$queryRaw<RawRow[]>`
      ${source}
      SELECT r."entityType", r.id, r.code, r.label, r.context, r."deletedAt",
             u.id AS "userId", u.name AS "userName", u."imageUrl" AS "userImageUrl"
      ${from} ${where}
      ORDER BY ${sort} ${direction}, r.id ASC
      LIMIT ${take} OFFSET ${skip}`;

    return paginated(rows.map(toTrashRow), total, query);
  }

  private where(query: TrashReadQuery): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    // Business days are Caracas days (PRD §6, DT-43). `deletedAt` is a UTC `timestamp` (no zone): tag it
    // UTC first, then read it as Caracas wall time.
    const day = Prisma.sql`((r."deletedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE})::date`;
    if (query.deletedFrom) conditions.push(Prisma.sql`${day} >= ${query.deletedFrom}::date`);
    if (query.deletedTo) conditions.push(Prisma.sql`${day} <= ${query.deletedTo}::date`);
    if (query.deletedById) {
      conditions.push(Prisma.sql`r."archiverId" = ANY(${[...query.deletedById]}::text[])`);
    }
    const search = searchCondition(['label', 'code', 'context'], query.q);
    if (search) conditions.push(Prisma.sql`(${search})`);
    return conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
  }
}

function toTrashRow(row: RawRow): TrashRow {
  return {
    entity: {
      type: row.entityType,
      id: row.id,
      label: row.label,
      ...(row.code !== null ? { code: row.code } : {}),
    },
    context: row.context,
    deletedAt: row.deletedAt,
    deletedBy:
      row.userId !== null
        ? { id: row.userId, name: row.userName ?? '', imageUrl: row.userImageUrl }
        : null,
  };
}
