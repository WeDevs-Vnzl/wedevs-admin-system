import { Injectable } from '@nestjs/common';
import type { DateOnly } from '../../../shared/domain/business-date';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { searchCondition } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  CurrentVersionView,
  DocumentLinkEntityType,
  DocumentLinkRecord,
  DocumentLinkTarget,
  DocumentListCriteria,
  DocumentMetaPatch,
  DocumentRecord,
  DocumentRelations,
  DocumentRepository,
  NewDocument,
  NewDocumentVersion,
  UserRef,
} from '../application/ports/document.repository.port';

/** The `DocumentLink` column that holds each target type (`doclink_one_target` allows exactly one). */
const LINK_COLUMN = {
  CLIENT: 'clientId',
  CONTACT: 'contactId',
  PROJECT: 'projectId',
  INVOICE: 'invoiceId',
  PAYMENT: 'paymentId',
  EXPENSE: 'expenseId',
} as const satisfies Record<DocumentLinkEntityType, string>;
type LinkColumn = (typeof LINK_COLUMN)[DocumentLinkEntityType];
const LINK_COLUMNS = Object.entries(LINK_COLUMN) as [DocumentLinkEntityType, LinkColumn][];

/** The `SearchEntry` columns `q` looks into (DT-141, `data-rules.md` §7). */
const SEARCH_COLUMNS = ['code', 'title', 'subtitle', 'body'] as const;

type DocumentRow = Prisma.DocumentGetPayload<object>;
type LinkRow = Prisma.DocumentLinkGetPayload<object>;

const optionalDate = (value: Date | null): DateOnly | null =>
  value === null ? null : dbDateToDateOnly(value);

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    typeId: row.typeId,
    summary: row.summary,
    status: row.status,
    draftContent: row.draftContent,
    draftUpdatedAt: row.draftUpdatedAt,
    currentVersionId: row.currentVersionId,
    effectiveDate: optionalDate(row.effectiveDate),
    signedAt: optionalDate(row.signedAt),
    expiresAt: optionalDate(row.expiresAt),
    alertDaysBefore: row.alertDaysBefore,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    deletedAt: row.deletedAt,
  };
}

function toLink(row: LinkRow): DocumentLinkRecord[] {
  const found = LINK_COLUMNS.find(([, column]) => row[column] !== null);
  if (!found) return [];
  return [
    {
      id: row.id,
      target: { entityType: found[0], entityId: row[found[1]] as string },
      createdAt: row.createdAt,
    },
  ];
}

const optionalDbDate = (value: DateOnly | null | undefined): Date | null =>
  value ? dateOnlyToDbDate(value) : null;

// ───────────────────────────── List SQL ─────────────────────────────

/** `column::text = ANY($values)`; the column is a whitelisted literal, the values are parameters. */
const anyOf = (column: string, values: readonly string[]): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(column)}::text = ANY(${[...values]}::text[])`;

const linkExists = (column: LinkColumn, ids: readonly string[]): Prisma.Sql =>
  Prisma.sql`EXISTS (SELECT 1 FROM "DocumentLink" l WHERE l."documentId" = d."id" AND ${anyOf(`l."${column}"`, ids)})`;

/** In a share link that is neither revoked nor expired on `today` (the derived status, choice 7). */
const sharedExists = (today: DateOnly): Prisma.Sql =>
  Prisma.sql`EXISTS (SELECT 1 FROM "ShareLinkDocument" sd JOIN "ShareLink" s ON s."id" = sd."shareLinkId" WHERE sd."documentId" = d."id" AND s."revokedAt" IS NULL AND (s."expiresAt" IS NULL OR s."expiresAt" >= ${dateOnlyToDbDate(today)}::date))`;

const FROM = Prisma.sql`FROM "Document" d
  JOIN "DocumentType" t ON t."id" = d."typeId"
  JOIN "DocumentCategory" c ON c."id" = t."categoryId"
  LEFT JOIN "DocumentVersion" v ON v."id" = d."currentVersionId"`;

/** Every `WHERE` condition of the criteria; `ignoreCategory` is for the category chips. */
function conditionsOf(c: DocumentListCriteria, ignoreCategory: boolean): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  const { archived, q } = c.query;
  if (archived === 'exclude') parts.push(Prisma.sql`d."deletedAt" IS NULL`);
  else if (archived === 'only') parts.push(Prisma.sql`d."deletedAt" IS NOT NULL`);

  if (c.statuses.length > 0) parts.push(anyOf('d."status"', c.statuses));
  if (c.typeIds.length > 0) parts.push(anyOf('d."typeId"', c.typeIds));
  if (!ignoreCategory && c.categoryIds.length > 0)
    parts.push(anyOf('t."categoryId"', c.categoryIds));
  if (c.formats.length > 0) parts.push(anyOf('v."format"', c.formats));
  const facets: [LinkColumn, readonly string[]][] = [
    ['clientId', c.clientIds],
    ['contactId', c.contactIds],
    ['projectId', c.projectIds],
    ['invoiceId', c.invoiceIds],
    ['paymentId', c.paymentIds],
    ['expenseId', c.expenseIds],
  ];
  for (const [column, ids] of facets) if (ids.length > 0) parts.push(linkExists(column, ids));
  if (c.tagIds.length > 0) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "TagAssignment" ta WHERE ta."documentId" = d."id" AND ${anyOf('ta."tagId"', c.tagIds)})`,
    );
  }
  if (c.expiresFrom)
    parts.push(Prisma.sql`d."expiresAt" >= ${dateOnlyToDbDate(c.expiresFrom)}::date`);
  if (c.expiresTo) parts.push(Prisma.sql`d."expiresAt" <= ${dateOnlyToDbDate(c.expiresTo)}::date`);
  if (c.expiring) {
    parts.push(
      Prisma.sql`d."expiresAt" >= ${dateOnlyToDbDate(c.expiring.from)}::date AND d."expiresAt" <= ${dateOnlyToDbDate(c.expiring.to)}::date AND d."status"::text NOT IN ('VENCIDO', 'ANULADO')`,
    );
  }
  if (c.staleBefore) {
    parts.push(Prisma.sql`d."status"::text = 'BORRADOR' AND d."updatedAt" < ${c.staleBefore}`);
  }
  if (c.shared !== null) {
    parts.push(c.shared ? sharedExists(c.today) : Prisma.sql`NOT ${sharedExists(c.today)}`);
  }
  const text = searchCondition(SEARCH_COLUMNS, q);
  if (text) {
    parts.push(
      Prisma.sql`d."id" IN (SELECT "entityId" FROM "SearchEntry" WHERE "entityType" = 'DOCUMENT'::"EntityType" AND (${text}))`,
    );
  }
  return parts;
}

const whereOf = (parts: readonly Prisma.Sql[]): Prisma.Sql =>
  parts.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(
        parts.map((p) => Prisma.sql`(${p})`),
        ' AND ',
      )}`;

/** Sort fields of the API: the SQL expression and whether NULLs exist (they sort last both ways). */
const SORT_SQL: Readonly<Record<string, { expr: string; nullable?: boolean }>> = {
  code: { expr: 'd."code"' },
  title: { expr: 'd."title"' },
  category: { expr: 'c."name"' },
  type: { expr: 't."name"' },
  status: { expr: 'd."status"::text' },
  format: { expr: 'v."format"::text', nullable: true },
  versionNumber: { expr: 'v."versionNumber"', nullable: true },
  expiresAt: { expr: 'd."expiresAt"', nullable: true },
  updatedAt: { expr: 'd."updatedAt"' },
  createdAt: { expr: 'd."createdAt"' },
};

function orderOf(c: DocumentListCriteria): Prisma.Sql {
  const sort = c.query.sort ?? { field: 'updatedAt', direction: 'desc' as const };
  const entry = SORT_SQL[sort.field];
  if (!entry) throw new Error(`Sort field not in the resource map: ${sort.field}`);
  const direction = Prisma.raw(sort.direction === 'asc' ? 'ASC' : 'DESC');
  const nulls = entry.nullable ? Prisma.raw(' NULLS LAST') : Prisma.empty;
  return Prisma.sql`${Prisma.raw(entry.expr)} ${direction}${nulls}, d."id" ASC`;
}

/**
 * `Document`, `DocumentLink` and `DocumentVersion` through the current transaction. `findUnique` is not
 * covered by the soft-delete extension, so by-id reads return archived documents and the use cases decide
 * (C19). The list is paged in SQL (joins on type, category and current version for the sorts and facets,
 * `SearchEntry` for `q`); Node sees at most a page of ids. Reads of `TagAssignment`, `DocumentType`,
 * `DocumentCategory`, `User` and `File` metadata are the read-only ones DT-140 accepts.
 */
@Injectable()
export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly host: TransactionHost) {}

  async insert(document: NewDocument): Promise<void> {
    await this.host.db.document.create({
      data: {
        id: document.id,
        code: document.code,
        title: document.title,
        typeId: document.typeId,
        summary: document.summary,
        status: document.status,
        draftContent: document.draftContent,
        draftUpdatedAt: document.draftUpdatedAt,
        currentVersionId: document.currentVersionId,
        effectiveDate: optionalDbDate(document.effectiveDate),
        signedAt: optionalDbDate(document.signedAt),
        expiresAt: optionalDbDate(document.expiresAt),
        alertDaysBefore: document.alertDaysBefore,
        createdAt: document.createdAt,
        updatedAt: document.createdAt,
        createdById: document.createdById,
        updatedById: document.createdById,
      },
    });
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    const row = await this.host.db.document.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async list(criteria: DocumentListCriteria): Promise<Paginated<DocumentRecord>> {
    const db = this.host.db;
    const { query } = criteria;
    const { skip, take } = pageWindow(query.page, query.pageSize);
    const where = whereOf(conditionsOf(criteria, false));
    const rows = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT d."id" ${FROM} ${where} ORDER BY ${orderOf(criteria)} LIMIT ${take} OFFSET ${skip}`,
    );
    const counted = await db.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int AS "total" ${FROM} ${where}`,
    );
    const total = counted[0]?.total ?? 0;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return paginated([], total, query);
    // `deletedAt` stated (even as `undefined`) tells the soft-delete extension to leave the query alone.
    const found = await db.document.findMany({ where: { id: { in: ids }, deletedAt: undefined } });
    const byId = new Map(found.map((row) => [row.id, toRecord(row)]));
    const items = ids.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    });
    return paginated(items, total, query);
  }

  async countByCategory(criteria: DocumentListCriteria): Promise<Record<string, number>> {
    const where = whereOf(conditionsOf(criteria, true));
    const rows = await this.host.db.$queryRaw<{ categoryId: string; count: number }[]>(
      Prisma.sql`SELECT t."categoryId" AS "categoryId", count(*)::int AS "count" ${FROM} ${where} GROUP BY t."categoryId"`,
    );
    return Object.fromEntries(rows.map((row) => [row.categoryId, row.count]));
  }

  async relationsOf(
    ids: readonly string[],
    today: DateOnly,
  ): Promise<Map<string, DocumentRelations>> {
    const result = new Map<string, DocumentRelations>();
    if (ids.length === 0) return result;
    const db = this.host.db;
    const docs = await db.document.findMany({
      where: { id: { in: [...ids] }, deletedAt: undefined },
      select: { id: true, createdById: true, currentVersionId: true },
    });
    const versionIds = docs.flatMap((doc) => (doc.currentVersionId ? [doc.currentVersionId] : []));
    const versions = await db.documentVersion.findMany({
      where: { id: { in: versionIds } },
      include: {
        file: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            uploadedById: true,
            createdAt: true,
          },
        },
      },
    });
    const counts = await db.documentVersion.groupBy({
      by: ['documentId'],
      where: { documentId: { in: [...ids] } },
      _count: { _all: true },
    });
    const links = await db.documentLink.findMany({
      where: { documentId: { in: [...ids] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const shared = await db.$queryRaw<{ documentId: string }[]>(
      Prisma.sql`SELECT DISTINCT sd."documentId" FROM "ShareLinkDocument" sd JOIN "ShareLink" s ON s."id" = sd."shareLinkId" WHERE ${anyOf('sd."documentId"', ids)} AND s."revokedAt" IS NULL AND (s."expiresAt" IS NULL OR s."expiresAt" >= ${dateOnlyToDbDate(today)}::date)`,
    );
    const userIds = [
      ...new Set([
        ...docs.flatMap((doc) => (doc.createdById ? [doc.createdById] : [])),
        ...versions.map((version) => version.createdById),
      ]),
    ];
    const users = new Map<string, UserRef>(
      (
        await db.user.findMany({
          where: { id: { in: userIds }, deletedAt: undefined },
          select: { id: true, name: true, imageUrl: true },
        })
      ).map((user) => [user.id, user]),
    );
    const userRef = (id: string): UserRef => users.get(id) ?? { id, name: '', imageUrl: null };

    const versionById = new Map(versions.map((version) => [version.id, version]));
    const countByDoc = new Map(counts.map((row) => [row.documentId, row._count._all]));
    const sharedIds = new Set(shared.map((row) => row.documentId));
    for (const doc of docs) {
      const version = doc.currentVersionId ? versionById.get(doc.currentVersionId) : undefined;
      const current: CurrentVersionView | null = version
        ? {
            id: version.id,
            documentId: version.documentId,
            versionNumber: version.versionNumber,
            format: version.format,
            content: version.content,
            file: version.file,
            url: version.url,
            changelog: version.changelog,
            createdBy: userRef(version.createdById),
            createdAt: version.createdAt,
          }
        : null;
      result.set(doc.id, {
        currentVersion: current,
        versionCount: countByDoc.get(doc.id) ?? 0,
        links: links.filter((link) => link.documentId === doc.id).flatMap(toLink),
        isShared: sharedIds.has(doc.id),
        createdBy: doc.createdById ? userRef(doc.createdById) : null,
      });
    }
    return result;
  }

  async labels(
    ids: readonly string[],
  ): Promise<Map<string, { code: string; title: string; archived: boolean }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.host.db.document.findMany({
      where: { id: { in: [...ids] }, deletedAt: undefined },
      select: { id: true, code: true, title: true, deletedAt: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        { code: row.code, title: row.title, archived: row.deletedAt !== null },
      ]),
    );
  }

  async updateMeta(id: string, patch: DocumentMetaPatch): Promise<void> {
    await this.host.db.document.update({
      where: { id },
      data: {
        title: patch.title,
        typeId: patch.typeId,
        summary: patch.summary,
        effectiveDate: optionalDbDate(patch.effectiveDate),
        signedAt: optionalDbDate(patch.signedAt),
        expiresAt: optionalDbDate(patch.expiresAt),
        alertDaysBefore: patch.alertDaysBefore,
        updatedAt: patch.updatedAt,
        updatedById: patch.updatedById,
      },
    });
  }

  async setStatus(
    id: string,
    change: {
      readonly status: DocumentRecord['status'];
      readonly signedAt: DateOnly | null;
      readonly updatedAt: Date;
      readonly updatedById: string | null;
    },
  ): Promise<void> {
    await this.host.db.document.update({
      where: { id },
      data: {
        status: change.status,
        signedAt: optionalDbDate(change.signedAt),
        updatedAt: change.updatedAt,
        updatedById: change.updatedById,
      },
    });
  }

  async archive(ids: readonly string[], at: Date, byUserId: string): Promise<void> {
    await this.host.db.document.updateMany({
      where: { id: { in: [...ids] } },
      data: { deletedAt: at, deletedById: byUserId, updatedAt: at, updatedById: byUserId },
    });
  }

  async restore(id: string, at: Date, byUserId: string): Promise<void> {
    await this.host.db.document.update({
      where: { id },
      data: { deletedAt: null, deletedById: null, updatedAt: at, updatedById: byUserId },
    });
  }

  async links(documentId: string): Promise<DocumentLinkRecord[]> {
    const rows = await this.host.db.documentLink.findMany({
      where: { documentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap(toLink);
  }

  async addLink(
    documentId: string,
    target: DocumentLinkTarget,
    link: { readonly id: string; readonly createdAt: Date; readonly createdById: string },
  ): Promise<boolean> {
    // `skipDuplicates` is `ON CONFLICT DO NOTHING`: a repeated target is not a unique violation that would
    // abort the transaction, it simply writes nothing.
    const result = await this.host.db.documentLink.createMany({
      data: [
        {
          id: link.id,
          documentId,
          [LINK_COLUMN[target.entityType]]: target.entityId,
          createdAt: link.createdAt,
          createdById: link.createdById,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async removeLink(documentId: string, target: DocumentLinkTarget): Promise<boolean> {
    const result = await this.host.db.documentLink.deleteMany({
      where: { documentId, [LINK_COLUMN[target.entityType]]: target.entityId },
    });
    return result.count > 0;
  }

  async isFileHeldByVersion(fileId: string): Promise<boolean> {
    return (await this.host.db.documentVersion.count({ where: { fileId } })) > 0;
  }

  async appendVersion(version: NewDocumentVersion): Promise<{ readonly versionNumber: number }> {
    const db = this.host.db;
    const last = await db.documentVersion.aggregate({
      where: { documentId: version.documentId },
      _max: { versionNumber: true },
    });
    const versionNumber = (last._max.versionNumber ?? 0) + 1;
    await db.documentVersion.create({
      data: {
        id: version.id,
        documentId: version.documentId,
        versionNumber,
        format: version.format,
        content: version.content,
        fileId: version.fileId,
        url: version.url,
        changelog: version.changelog,
        createdAt: version.createdAt,
        createdById: version.createdById,
      },
    });
    await db.document.update({
      where: { id: version.documentId },
      data: { currentVersionId: version.id, updatedAt: version.createdAt },
    });
    return { versionNumber };
  }

  async currentMarkdown(documentId: string): Promise<string | null> {
    const row = await this.host.db.document.findUnique({
      where: { id: documentId },
      select: { currentVersion: { select: { format: true, content: true } } },
    });
    const version = row?.currentVersion;
    return version && version.format === 'MARKDOWN' ? version.content : null;
  }

  async expiredIds(today: DateOnly): Promise<string[]> {
    const rows = await this.host.db.document.findMany({
      where: {
        status: { notIn: ['ANULADO', 'VENCIDO'] },
        expiresAt: { lt: dateOnlyToDbDate(today) },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
