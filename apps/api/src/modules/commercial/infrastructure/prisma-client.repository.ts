import { Injectable } from '@nestjs/common';
import { BUSINESS_TIME_ZONE } from '../../../shared/domain/business-date';
import { ConflictError } from '../../../shared/domain/domain-error';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { searchCondition } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import type {
  ClientListEntry,
  ClientListQuery,
  ClientRepository,
} from '../application/ports/client.repository.port';
import {
  ACTIVE_PROJECT_STATUSES,
  CLIENT_DUPLICATE_TAX_ID_KEY,
  type ClientRecord,
} from '../domain/client';
import { taxIdKey } from '../domain/tax-id';

/** The partial unique index on live clients (migration `complementary_sql`). */
const TAX_ID_CONSTRAINT = 'client_taxid_country_active';

const SEARCH_COLUMNS = ['tradeName', 'legalName', 'code', 'taxId', 'email'] as const;

/** Sort expressions over `"Client" c LEFT JOIN "ClientMetrics" m` (trusted constants, never user text). */
const SORT_SQL: Record<string, { readonly sql: Prisma.Sql; readonly nullable?: boolean }> = {
  code: { sql: Prisma.sql`c."code"` },
  tradeName: { sql: Prisma.sql`unaccent(lower(c."tradeName"))` },
  kind: { sql: Prisma.sql`c."kind"::text` },
  country: { sql: Prisma.sql`c."country"::text` },
  status: { sql: Prisma.sql`c."status"::text` },
  projectCount: { sql: Prisma.sql`COALESCE(m."projectCount", 0)` },
  totalInvoicedUsd: { sql: Prisma.sql`COALESCE(m."invoicedUsd", 0)` },
  receivableUsd: { sql: Prisma.sql`COALESCE(m."receivableUsd", 0)` },
  lastActivityAt: { sql: Prisma.sql`m."lastActivityAt"`, nullable: true },
  createdAt: { sql: Prisma.sql`c."createdAt"` },
};

type ClientRow = {
  id: string;
  code: string;
  kind: ClientRecord['kind'];
  tradeName: string;
  legalName: string;
  taxId: string;
  country: string;
  address: string;
  phone: string;
  email: string | null;
  website: string | null;
  status: ClientRecord['status'];
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function toRecord(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    tradeName: row.tradeName,
    legalName: row.legalName,
    taxId: row.taxId,
    country: row.country,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    status: row.status,
    activatedAt: row.activatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toValues(record: ClientRecord) {
  return {
    kind: record.kind,
    tradeName: record.tradeName,
    legalName: record.legalName,
    taxId: record.taxId,
    country: record.country,
    address: record.address,
    phone: record.phone,
    email: record.email,
    website: record.website,
    status: record.status,
    activatedAt: record.activatedAt,
    updatedAt: record.updatedAt,
  };
}

/** Lost race on the (tax id, country) partial unique: the same `CONFLICT` the use case raises (holder unknown here). */
function translateWriteError(error: unknown): unknown {
  return isUniqueViolation(error, TAX_ID_CONSTRAINT)
    ? new ConflictError({ message: CLIENT_DUPLICATE_TAX_ID_KEY })
    : error;
}

/** `Decimal(18, 2)` as the contract's decimal string; the absent row reads `"0.00"`. */
const usd = (value: Prisma.Decimal | undefined): string =>
  (value ?? new Prisma.Decimal(0)).toFixed(2);

/**
 * `Client` rows through the current transaction (or the base client outside a unit of work). Writes run in
 * the caller's unit of work. The list reads `ClientMetrics` with a read-only 1:1 join (the read model that
 * serves exactly these columns, `data-rules.md` §3b) and, for the tag facet, `TagAssignment` as a
 * read-only `EXISTS` predicate: a documented cross-context read, never a write.
 */
@Injectable()
export class PrismaClientRepository implements ClientRepository {
  constructor(private readonly host: TransactionHost) {}

  async findById(id: string): Promise<ClientRecord | null> {
    const row = await this.host.db.client.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<ClientRecord | null> {
    const tx = this.host.requireTransaction('ClientRepository.findByIdForUpdate');
    // Blocks while another transaction holds the row; the read after it sees what that one committed.
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${id} FOR UPDATE`;
    return this.findById(id);
  }

  async findTaxIdHolder(
    taxId: string,
    country: string,
    exceptId?: string,
  ): Promise<ClientRecord | null> {
    const db = this.host.db;
    const except = exceptId === undefined ? Prisma.empty : Prisma.sql`AND "id" <> ${exceptId}`;
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Client"
      WHERE "deletedAt" IS NULL AND "country" = ${country}
        AND upper(regexp_replace("taxId", ${'[[:space:].-]'}, '', 'g')) = ${taxIdKey(taxId)}
        ${except}
      ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`;
    const id = rows[0]?.id;
    return id === undefined ? null : this.findById(id);
  }

  async hasActiveProjects(clientId: string): Promise<boolean> {
    const count = await this.host.db.project.count({
      where: {
        deletedAt: null,
        status: { in: [...ACTIVE_PROJECT_STATUSES] },
        clients: { some: { clientId } },
      },
    });
    return count > 0;
  }

  async insert(record: ClientRecord): Promise<void> {
    const tx = this.host.requireTransaction('ClientRepository.insert');
    try {
      await tx.client.create({
        data: {
          id: record.id,
          code: record.code,
          createdAt: record.createdAt,
          ...toValues(record),
        },
      });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async update(record: ClientRecord): Promise<void> {
    const tx = this.host.requireTransaction('ClientRepository.update');
    try {
      await tx.client.update({ where: { id: record.id }, data: toValues(record) });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async archive(id: string, at: Date, byUserId: string): Promise<void> {
    const tx = this.host.requireTransaction('ClientRepository.archive');
    await tx.client.update({
      where: { id },
      data: { deletedAt: at, deletedById: byUserId, updatedAt: at },
    });
  }

  async restore(id: string, at: Date): Promise<void> {
    const tx = this.host.requireTransaction('ClientRepository.restore');
    try {
      await tx.client.update({
        where: { id },
        data: { deletedAt: null, deletedById: null, updatedAt: at },
      });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async list(query: ClientListQuery): Promise<Paginated<ClientListEntry>> {
    const db = this.host.db;
    const where = this.where(query);
    const from = Prisma.sql`FROM "Client" c LEFT JOIN "ClientMetrics" m ON m."clientId" = c."id"`;
    const sort = SORT_SQL[query.sort.field] ?? SORT_SQL.code;
    const direction = Prisma.raw(query.sort.direction === 'desc' ? 'DESC' : 'ASC');
    const nulls = sort?.nullable ? Prisma.raw(' NULLS LAST') : Prisma.empty;
    const { skip, take } = pageWindow(query.page, query.pageSize);

    const pageRows = await db.$queryRaw<{ id: string }[]>`
      SELECT c."id" ${from} ${where}
      ORDER BY ${sort?.sql ?? Prisma.empty} ${direction}${nulls}, c."id" ASC
      LIMIT ${take} OFFSET ${skip}`;
    const counted = await db.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS "total" ${from} ${where}`;
    const total = counted[0]?.total ?? 0;
    const ids = pageRows.map((row) => row.id);
    if (ids.length === 0) return paginated([], total, query);

    // `deletedAt: undefined` states the key, so the soft-delete extension leaves the archived mode alone.
    const rows = await db.client.findMany({
      where: { id: { in: ids }, deletedAt: undefined },
      include: { metrics: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items: ClientListEntry[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      items.push({
        client: toRecord(row),
        projectCount: row.metrics?.projectCount ?? 0,
        lastActivityAt: row.metrics?.lastActivityAt ?? null,
        totalInvoicedUsd: usd(row.metrics?.invoicedUsd),
        receivableUsd: usd(row.metrics?.receivableUsd),
      });
    }
    return paginated(items, total, query);
  }

  async search(q: string | undefined, limit: number): Promise<ClientRecord[]> {
    const db = this.host.db;
    const text = searchCondition(SEARCH_COLUMNS, q);
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Client"
      WHERE "deletedAt" IS NULL ${text ? Prisma.sql`AND (${text})` : Prisma.empty}
      ORDER BY unaccent(lower("tradeName")) ASC, "id" ASC LIMIT ${limit}`;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const found = await db.client.findMany({ where: { id: { in: ids } } });
    const byId = new Map(found.map((row) => [row.id, toRecord(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  private where(query: ClientListQuery): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    if (query.archived === 'exclude') conditions.push(Prisma.sql`c."deletedAt" IS NULL`);
    if (query.archived === 'only') conditions.push(Prisma.sql`c."deletedAt" IS NOT NULL`);
    if (query.status?.length) {
      conditions.push(Prisma.sql`c."status"::text = ANY(${[...query.status]}::text[])`);
    }
    if (query.kind?.length) {
      conditions.push(Prisma.sql`c."kind"::text = ANY(${[...query.kind]}::text[])`);
    }
    if (query.country?.length) {
      conditions.push(Prisma.sql`c."country"::text = ANY(${[...query.country]}::text[])`);
    }
    if (query.tagIds?.length) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "TagAssignment" ta
        WHERE ta."clientId" = c."id" AND ta."tagId" = ANY(${[...query.tagIds]}::text[]))`);
    }
    // Business days are Caracas days (PRD §6, DT-43); `createdAt` is a UTC `timestamp` without zone.
    const day = Prisma.sql`((c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE})::date`;
    if (query.createdFrom) conditions.push(Prisma.sql`${day} >= ${query.createdFrom}::date`);
    if (query.createdTo) conditions.push(Prisma.sql`${day} <= ${query.createdTo}::date`);
    if (query.hasOverdue !== undefined) {
      conditions.push(
        query.hasOverdue
          ? Prisma.sql`COALESCE(m."overdueUsd", 0) > 0`
          : Prisma.sql`COALESCE(m."overdueUsd", 0) = 0`,
      );
    }
    const search = searchCondition(SEARCH_COLUMNS, query.q);
    if (search) conditions.push(Prisma.sql`(${search})`);
    return conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
  }
}
