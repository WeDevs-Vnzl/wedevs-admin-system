import { Injectable } from '@nestjs/common';
import { BUSINESS_TIME_ZONE, type DateOnly } from '../../../shared/domain/business-date';
import type { ShareEvent } from '../../../shared/domain/enums';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { escapeLike } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ShareCounters } from '../domain';
import type { UserRef } from '../application/ports/document.repository.port';
import type {
  NewShareLink,
  SharableDocument,
  ShareAccessLogCriteria,
  ShareAccessLogEntry,
  ShareDocumentLink,
  ShareDocumentRead,
  ShareDocumentWrite,
  ShareKeyChange,
  ShareLinkListCriteria,
  ShareLinkPatch,
  ShareLinkRecord,
  ShareLinkRelations,
  ShareLinkRepository,
  ShareLocale,
} from '../application/ports/share-link.repository.port';

type LinkRow = Prisma.ShareLinkGetPayload<object>;
type DocumentLinkRow = Prisma.ShareLinkDocumentGetPayload<object>;

const NO_COUNTERS: ShareCounters = {
  viewCount: 0,
  downloadCount: 0,
  unlockCount: 0,
  failedUnlockCount: 0,
};

function toRecord(row: LinkRow): ShareLinkRecord {
  return {
    id: row.id,
    token: row.token,
    title: row.title,
    message: row.message,
    clientId: row.clientId,
    locale: row.locale as ShareLocale,
    allowDownload: row.allowDownload,
    expiresAt: row.expiresAt ? dbDateToDateOnly(row.expiresAt) : null,
    expiredAt: row.expiredAt,
    revokedAt: row.revokedAt,
    viewCount: row.viewCount,
    downloadCount: row.downloadCount,
    lastAccessedAt: row.lastAccessedAt,
    createdAt: row.createdAt,
    createdById: row.createdById,
  };
}

function toDocumentLink(row: DocumentLinkRow): ShareDocumentLink {
  return {
    shareLinkId: row.shareLinkId,
    documentId: row.documentId,
    versionId: row.versionId,
    order: row.order,
    hasAccessKey: row.accessKeyHash !== null,
    accessKeyUpdatedAt: row.accessKeyHash !== null ? row.accessKeyUpdatedAt : null,
  };
}

/** The key columns a write sets; `keep` leaves them out of an update. */
function keyColumns(key: ShareKeyChange): {
  accessKeyHash?: string | null;
  accessKeyUpdatedAt?: Date | null;
} {
  if (key.kind === 'keep') return {};
  if (key.kind === 'clear') return { accessKeyHash: null, accessKeyUpdatedAt: null };
  return { accessKeyHash: key.hash, accessKeyUpdatedAt: key.updatedAt };
}

// ───────────────────────────── List SQL ─────────────────────────────

const anyOf = (column: string, values: readonly string[]): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(column)}::text = ANY(${[...values]}::text[])`;

/** The derived status of a link on `today` (choice 7): revoked wins, then the day after the last valid one. */
const statusSql = (today: DateOnly): Prisma.Sql =>
  Prisma.sql`(CASE WHEN s."revokedAt" IS NOT NULL THEN 'REVOKED' WHEN s."expiresAt" IS NOT NULL AND s."expiresAt" < ${dateOnlyToDbDate(today)}::date THEN 'EXPIRED' ELSE 'ACTIVE' END)`;

/** The Caracas business day of an instant column. */
const caracasDay = (column: string): Prisma.Sql =>
  Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE})::date`;

const contains = (expression: string, pattern: string): Prisma.Sql =>
  Prisma.sql`unaccent(lower(${Prisma.raw(expression)})) LIKE '%' || unaccent(lower(${pattern})) || '%' ESCAPE '\\'`;

const FROM = Prisma.sql`FROM "ShareLink" s LEFT JOIN "Client" c ON c."id" = s."clientId"`;

function linkConditions(c: ShareLinkListCriteria): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (c.statuses.length > 0) {
    parts.push(Prisma.sql`${statusSql(c.today)} = ANY(${[...c.statuses]}::text[])`);
  }
  if (c.clientIds.length > 0) parts.push(anyOf('s."clientId"', c.clientIds));
  if (c.documentId) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "ShareLinkDocument" d WHERE d."shareLinkId" = s."id" AND d."documentId" = ${c.documentId})`,
    );
  }
  if (c.hasAccessKeys !== null) {
    const keyed = Prisma.sql`EXISTS (SELECT 1 FROM "ShareLinkDocument" d WHERE d."shareLinkId" = s."id" AND d."accessKeyHash" IS NOT NULL)`;
    parts.push(c.hasAccessKeys ? keyed : Prisma.sql`NOT ${keyed}`);
  }
  if (c.createdFrom) {
    parts.push(
      Prisma.sql`${caracasDay('s."createdAt"')} >= ${dateOnlyToDbDate(c.createdFrom)}::date`,
    );
  }
  if (c.createdTo) {
    parts.push(
      Prisma.sql`${caracasDay('s."createdAt"')} <= ${dateOnlyToDbDate(c.createdTo)}::date`,
    );
  }
  const q = c.query.q?.trim();
  if (q) {
    const pattern = escapeLike(q);
    parts.push(
      Prisma.sql`${contains('s."title"', pattern)} OR ${contains('c."tradeName"', pattern)} OR ${contains('c."code"', pattern)}`,
    );
  }
  return parts;
}

const whereOf = (parts: readonly Prisma.Sql[]): Prisma.Sql =>
  parts.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(
        parts.map((part) => Prisma.sql`(${part})`),
        ' AND ',
      )}`;

function linkOrder(c: ShareLinkListCriteria): Prisma.Sql {
  const sort = c.query.sort ?? { field: 'createdAt', direction: 'desc' as const };
  const sorts: Record<string, { expr: Prisma.Sql; nullable?: boolean }> = {
    title: { expr: Prisma.sql`s."title"` },
    status: { expr: statusSql(c.today) },
    expiresAt: { expr: Prisma.sql`s."expiresAt"`, nullable: true },
    viewCount: { expr: Prisma.sql`s."viewCount"` },
    downloadCount: { expr: Prisma.sql`s."downloadCount"` },
    lastAccessedAt: { expr: Prisma.sql`s."lastAccessedAt"`, nullable: true },
    createdAt: { expr: Prisma.sql`s."createdAt"` },
  };
  const entry = sorts[sort.field];
  if (!entry) throw new Error(`Sort field not in the resource map: ${sort.field}`);
  const direction = Prisma.raw(sort.direction === 'asc' ? 'ASC' : 'DESC');
  const nulls = entry.nullable ? Prisma.raw(' NULLS LAST') : Prisma.empty;
  return Prisma.sql`${entry.expr} ${direction}${nulls}, s."id" ASC`;
}

function logConditions(c: ShareAccessLogCriteria): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [Prisma.sql`l."shareLinkId" = ${c.shareLinkId}`];
  if (c.events.length > 0) parts.push(anyOf('l."event"', c.events));
  if (c.documentId) parts.push(Prisma.sql`l."documentId" = ${c.documentId}`);
  if (c.from) {
    parts.push(Prisma.sql`${caracasDay('l."createdAt"')} >= ${dateOnlyToDbDate(c.from)}::date`);
  }
  if (c.to) {
    parts.push(Prisma.sql`${caracasDay('l."createdAt"')} <= ${dateOnlyToDbDate(c.to)}::date`);
  }
  return parts;
}

/**
 * `ShareLink`, `ShareLinkDocument` and the read side of `ShareAccessLog` through the current transaction. The
 * hash of a key is written and read only here (`accessKeyHashOf`, for the portal's unlock check) and never
 * crosses into a read model; the visitor of an access-log row is cut to 12 characters in SQL. Reads of
 * `Document`, `DocumentVersion`, `User` and the `Client` label are the read-only ones DT-140 accepts.
 */
@Injectable()
export class PrismaShareLinkRepository implements ShareLinkRepository {
  constructor(private readonly host: TransactionHost) {}

  async insert(link: NewShareLink, documents: readonly ShareDocumentWrite[]): Promise<void> {
    await this.host.db.shareLink.create({
      data: {
        id: link.id,
        token: link.token,
        title: link.title,
        message: link.message,
        clientId: link.clientId,
        locale: link.locale,
        allowDownload: link.allowDownload,
        expiresAt: link.expiresAt ? dateOnlyToDbDate(link.expiresAt) : null,
        createdAt: link.createdAt,
        createdById: link.createdById,
        documents: {
          create: documents.map((item) => ({
            documentId: item.documentId,
            versionId: item.versionId,
            order: item.order,
            ...keyColumns(item.key),
          })),
        },
      },
    });
  }

  async findById(id: string): Promise<ShareLinkRecord | null> {
    const row = await this.host.db.shareLink.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByToken(token: string): Promise<ShareLinkRecord | null> {
    const row = await this.host.db.shareLink.findUnique({ where: { token } });
    return row ? toRecord(row) : null;
  }

  async documentsOf(shareLinkId: string): Promise<ShareDocumentLink[]> {
    const rows = await this.host.db.shareLinkDocument.findMany({
      where: { shareLinkId },
      orderBy: [{ order: 'asc' }, { documentId: 'asc' }],
    });
    return rows.map(toDocumentLink);
  }

  async accessKeyHashOf(shareLinkId: string, documentId: string): Promise<string | null> {
    const row = await this.host.db.shareLinkDocument.findUnique({
      where: { shareLinkId_documentId: { shareLinkId, documentId } },
      select: { accessKeyHash: true },
    });
    return row?.accessKeyHash ?? null;
  }

  async update(id: string, patch: ShareLinkPatch): Promise<void> {
    await this.host.db.shareLink.update({
      where: { id },
      data: {
        title: patch.title,
        message: patch.message,
        clientId: patch.clientId,
        locale: patch.locale,
        allowDownload: patch.allowDownload,
        expiresAt: patch.expiresAt ? dateOnlyToDbDate(patch.expiresAt) : null,
        ...(patch.clearExpiredAt ? { expiredAt: null } : {}),
      },
    });
  }

  async replaceDocuments(
    shareLinkId: string,
    documents: readonly ShareDocumentWrite[],
  ): Promise<void> {
    const db = this.host.db;
    await db.shareLinkDocument.deleteMany({
      where: { shareLinkId, documentId: { notIn: documents.map((item) => item.documentId) } },
    });
    for (const item of documents) {
      const key = keyColumns(item.key);
      await db.shareLinkDocument.upsert({
        where: { shareLinkId_documentId: { shareLinkId, documentId: item.documentId } },
        update: { versionId: item.versionId, order: item.order, ...key },
        create: {
          shareLinkId,
          documentId: item.documentId,
          versionId: item.versionId,
          order: item.order,
          ...key,
        },
      });
    }
  }

  async setKey(
    shareLinkId: string,
    documentId: string,
    key: { readonly hash: string; readonly updatedAt: Date } | null,
  ): Promise<void> {
    await this.host.db.shareLinkDocument.update({
      where: { shareLinkId_documentId: { shareLinkId, documentId } },
      data: key
        ? { accessKeyHash: key.hash, accessKeyUpdatedAt: key.updatedAt }
        : { accessKeyHash: null, accessKeyUpdatedAt: null },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.host.db.shareLink.update({ where: { id }, data: { revokedAt: at } });
  }

  async markExpired(id: string, at: Date): Promise<void> {
    await this.host.db.shareLink.update({ where: { id }, data: { expiredAt: at } });
  }

  async expiredIds(today: DateOnly): Promise<string[]> {
    const rows = await this.host.db.shareLink.findMany({
      where: { expiresAt: { lt: dateOnlyToDbDate(today) }, revokedAt: null, expiredAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async sharableDocuments(ids: readonly string[]): Promise<Map<string, SharableDocument>> {
    if (ids.length === 0) return new Map();
    const rows = await this.host.db.document.findMany({
      where: { id: { in: [...ids] }, deletedAt: undefined },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        currentVersionId: true,
        deletedAt: true,
      },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          code: row.code,
          title: row.title,
          status: row.status,
          currentVersionId: row.currentVersionId,
          archived: row.deletedAt !== null,
        },
      ]),
    );
  }

  async versionOwners(versionIds: readonly string[]): Promise<Map<string, string>> {
    if (versionIds.length === 0) return new Map();
    const rows = await this.host.db.documentVersion.findMany({
      where: { id: { in: [...versionIds] } },
      select: { id: true, documentId: true },
    });
    return new Map(rows.map((row) => [row.id, row.documentId]));
  }

  async list(criteria: ShareLinkListCriteria): Promise<Paginated<ShareLinkRecord>> {
    const db = this.host.db;
    const { query } = criteria;
    const { skip, take } = pageWindow(query.page, query.pageSize);
    const where = whereOf(linkConditions(criteria));
    const rows = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT s."id" ${FROM} ${where} ORDER BY ${linkOrder(criteria)} LIMIT ${take} OFFSET ${skip}`,
    );
    const counted = await db.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int AS "total" ${FROM} ${where}`,
    );
    const total = counted[0]?.total ?? 0;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return paginated([], total, query);
    const found = await db.shareLink.findMany({ where: { id: { in: ids } } });
    const byId = new Map(found.map((row) => [row.id, toRecord(row)]));
    return paginated(
      ids.flatMap((id) => {
        const record = byId.get(id);
        return record ? [record] : [];
      }),
      total,
      query,
    );
  }

  async relationsOf(ids: readonly string[]): Promise<Map<string, ShareLinkRelations>> {
    const result = new Map<string, ShareLinkRelations>();
    if (ids.length === 0) return result;
    const db = this.host.db;
    const links = await db.shareLink.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, createdById: true },
    });
    const rows = await db.shareLinkDocument.findMany({
      where: { shareLinkId: { in: [...ids] } },
      orderBy: [{ order: 'asc' }, { documentId: 'asc' }],
    });
    const documents = new Map(
      (await this.sharableDocuments([...new Set(rows.map((row) => row.documentId))])).entries(),
    );
    const servedIds = [
      ...new Set(
        rows.flatMap((row) => {
          const served = row.versionId ?? documents.get(row.documentId)?.currentVersionId ?? null;
          return served ? [served] : [];
        }),
      ),
    ];
    const versions = new Map(
      (
        await db.documentVersion.findMany({
          where: { id: { in: servedIds } },
          select: { id: true, versionNumber: true, format: true },
        })
      ).map((version) => [version.id, version]),
    );
    const grouped = await db.shareAccessLog.groupBy({
      by: ['shareLinkId', 'documentId', 'event'],
      where: { shareLinkId: { in: [...ids] } },
      _count: { _all: true },
    });
    const users = new Map<string, UserRef>(
      (
        await db.user.findMany({
          where: { id: { in: links.map((link) => link.createdById) }, deletedAt: undefined },
          select: { id: true, name: true, imageUrl: true },
        })
      ).map((user) => [user.id, user]),
    );

    const counters = (match: (row: (typeof grouped)[number]) => boolean): ShareCounters => {
      const out = { ...NO_COUNTERS };
      for (const row of grouped.filter(match)) {
        const count = row._count._all;
        if (row.event === 'VIEW') out.viewCount += count;
        else if (row.event === 'DOWNLOAD') out.downloadCount += count;
        else if (row.event === 'UNLOCK') out.unlockCount += count;
        else out.failedUnlockCount += count;
      }
      return out;
    };

    for (const link of links) {
      const own = counters((row) => row.shareLinkId === link.id);
      const reads = rows
        .filter((row) => row.shareLinkId === link.id)
        .flatMap((row): ShareDocumentRead[] => {
          const document = documents.get(row.documentId);
          if (!document) return [];
          const servedId = row.versionId ?? document.currentVersionId;
          const served = servedId ? versions.get(servedId) : undefined;
          return [
            {
              ...toDocumentLink(row),
              document,
              served: served
                ? { id: served.id, versionNumber: served.versionNumber, format: served.format }
                : null,
              counters: counters(
                (entry) => entry.shareLinkId === link.id && entry.documentId === row.documentId,
              ),
            },
          ];
        });
      result.set(link.id, {
        documents: reads,
        createdBy: users.get(link.createdById) ?? null,
        unlockCount: own.unlockCount,
        failedUnlockCount: own.failedUnlockCount,
      });
    }
    return result;
  }

  async listAccessLog(criteria: ShareAccessLogCriteria): Promise<Paginated<ShareAccessLogEntry>> {
    const db = this.host.db;
    const { query } = criteria;
    const { skip, take } = pageWindow(query.page, query.pageSize);
    const where = whereOf(logConditions(criteria));
    const sort = query.sort ?? { field: 'createdAt', direction: 'desc' as const };
    const column = sort.field === 'event' ? Prisma.sql`l."event"::text` : Prisma.sql`l."createdAt"`;
    const direction = Prisma.raw(sort.direction === 'asc' ? 'ASC' : 'DESC');
    const rows = await db.$queryRaw<
      {
        id: string;
        shareLinkId: string;
        event: ShareEvent;
        documentId: string | null;
        documentTitle: string | null;
        visitor: string;
        userAgent: string | null;
        createdAt: Date;
      }[]
    >(
      Prisma.sql`SELECT l."id", l."shareLinkId", l."event"::text AS "event", l."documentId", d."title" AS "documentTitle", left(l."ipHash", 12) AS "visitor", l."userAgent", l."createdAt" FROM "ShareAccessLog" l LEFT JOIN "Document" d ON d."id" = l."documentId" ${where} ORDER BY ${column} ${direction}, l."id" ASC LIMIT ${take} OFFSET ${skip}`,
    );
    const counted = await db.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int AS "total" FROM "ShareAccessLog" l ${where}`,
    );
    return paginated(rows, counted[0]?.total ?? 0, query);
  }
}
