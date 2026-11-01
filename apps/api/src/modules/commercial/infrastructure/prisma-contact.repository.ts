import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../../shared/domain/domain-error';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { Paginated } from '../../../shared/domain/pagination';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { listPage, searchCondition } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import type { ContactRepository } from '../application/ports/contact.repository.port';
import type { ContactRecord } from '../domain/contact';

/** The partial unique index: one live primary contact per client (migration `complementary_sql`). */
const PRIMARY_CONSTRAINT = 'contact_one_primary';

const SEARCH_COLUMNS = ['fullName', 'position', 'email', 'phone'] as const;

type ContactRow = {
  id: string;
  clientId: string;
  fullName: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function toRecord(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    fullName: row.fullName,
    position: row.position,
    email: row.email,
    phone: row.phone,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toValues(record: ContactRecord) {
  return {
    fullName: record.fullName,
    position: record.position,
    email: record.email,
    phone: record.phone,
    isPrimary: record.isPrimary,
    updatedAt: record.updatedAt,
  };
}

/** A lost race on the one-primary partial unique is a `CONFLICT` (CA2); anything else passes through. */
function translateWriteError(error: unknown): unknown {
  return isUniqueViolation(error, PRIMARY_CONSTRAINT) ? new ConflictError() : error;
}

/**
 * `Contact` rows through the current transaction (or the base client outside a unit of work). Writes run
 * in the caller's unit of work.
 */
@Injectable()
export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly host: TransactionHost) {}

  async findById(id: string): Promise<ContactRecord | null> {
    const row = await this.host.db.contact.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findLiveByClient(clientId: string): Promise<ContactRecord[]> {
    const rows = await this.host.db.contact.findMany({
      where: { clientId },
      orderBy: { id: 'asc' },
    });
    return rows.map(toRecord);
  }

  async findArchivedAt(clientId: string, deletedAt: Date): Promise<ContactRecord[]> {
    const rows = await this.host.db.contact.findMany({
      where: { clientId, deletedAt },
      orderBy: { id: 'asc' },
    });
    return rows.map(toRecord);
  }

  async findOtherPrimaries(clientId: string, exceptId: string | null): Promise<ContactRecord[]> {
    const rows = await this.host.db.contact.findMany({
      where: { clientId, isPrimary: true, ...(exceptId === null ? {} : { id: { not: exceptId } }) },
      orderBy: { id: 'asc' },
    });
    return rows.map(toRecord);
  }

  async insert(record: ContactRecord): Promise<void> {
    const tx = this.host.requireTransaction('ContactRepository.insert');
    try {
      await tx.contact.create({
        data: {
          id: record.id,
          clientId: record.clientId,
          createdAt: record.createdAt,
          ...toValues(record),
        },
      });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async update(record: ContactRecord): Promise<void> {
    const tx = this.host.requireTransaction('ContactRepository.update');
    try {
      await tx.contact.update({ where: { id: record.id }, data: toValues(record) });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async archive(id: string, at: Date): Promise<void> {
    const tx = this.host.requireTransaction('ContactRepository.archive');
    await tx.contact.update({
      where: { id },
      data: { deletedAt: at, isPrimary: false, updatedAt: at },
    });
  }

  async archiveLiveOfClient(clientId: string, at: Date): Promise<ContactRecord[]> {
    const tx = this.host.requireTransaction('ContactRepository.archiveLiveOfClient');
    const live = await tx.contact.findMany({ where: { clientId }, orderBy: { id: 'asc' } });
    if (live.length === 0) return [];
    await tx.contact.updateMany({
      where: { clientId, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
    return live.map((row) => ({ ...toRecord(row), deletedAt: at, updatedAt: at }));
  }

  async restoreMany(ids: readonly string[], at: Date): Promise<void> {
    const tx = this.host.requireTransaction('ContactRepository.restoreMany');
    if (ids.length === 0) return;
    try {
      await tx.contact.updateMany({
        where: { id: { in: [...ids] }, deletedAt: { not: null } },
        data: { deletedAt: null, updatedAt: at },
      });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async list(clientId: string, query: ListQuery): Promise<Paginated<ContactRecord>> {
    const db = this.host.db;
    const page = await listPage(db, {
      table: 'Contact',
      searchColumns: SEARCH_COLUMNS,
      sortMap: {
        fullName: 'fullName',
        position: { path: 'position', nullable: true },
        email: { path: 'email', nullable: true },
        isPrimary: 'isPrimary',
        createdAt: 'createdAt',
      },
      defaultSort: { field: 'isPrimary', direction: 'desc' },
      where: { clientId },
      sqlWhere: Prisma.sql`"clientId" = ${clientId}`,
      query,
      find: (args) => db.contact.findMany(args),
      count: (args) => db.contact.count(args),
    });
    return { ...page, items: page.items.map(toRecord) };
  }

  async search(
    q: string | undefined,
    clientId: string | undefined,
    limit: number,
  ): Promise<ContactRecord[]> {
    const db = this.host.db;
    const text = searchCondition(SEARCH_COLUMNS, q);
    // The client check is a subquery, so the unqualified column names above resolve to `Contact` only.
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Contact"
      WHERE "deletedAt" IS NULL
        AND "clientId" IN (SELECT "id" FROM "Client" WHERE "deletedAt" IS NULL)
        ${clientId === undefined ? Prisma.empty : Prisma.sql`AND "clientId" = ${clientId}`}
        ${text ? Prisma.sql`AND (${text})` : Prisma.empty}
      ORDER BY "isPrimary" DESC, unaccent(lower("fullName")) ASC, "id" ASC LIMIT ${limit}`;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const found = await db.contact.findMany({ where: { id: { in: ids } } });
    const byId = new Map(found.map((row) => [row.id, toRecord(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}
