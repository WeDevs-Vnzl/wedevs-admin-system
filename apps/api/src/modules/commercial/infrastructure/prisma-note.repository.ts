import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../../shared/domain/domain-error';
import type { SortSpec } from '../../../shared/domain/list-query';
import type { Paginated } from '../../../shared/domain/pagination';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { listPage, type SortMap } from '../../../shared/infrastructure/prisma/prisma-list';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  NewNote,
  NoteContentUpdate,
  NoteListCriteria,
  NoteRepository,
} from '../application/ports/note.repository.port';
import type { NoteFile, NoteRecord } from '../domain/note';
import {
  NOTE_ALREADY_LINKED_KEY,
  type NoteLinkEntityType,
  type NoteLinkTarget,
} from '../domain/note-link';
import type { RichTextDoc } from '../../../shared/domain/rich-text';

/** The `NoteLink` column that holds each target type (`notelink_one_target` allows exactly one). */
const LINK_COLUMN = {
  CLIENT: 'clientId',
  CONTACT: 'contactId',
  PROJECT: 'projectId',
  DOCUMENT: 'documentId',
  INVOICE: 'invoiceId',
  PAYMENT: 'paymentId',
  EXPENSE: 'expenseId',
} as const satisfies Record<NoteLinkEntityType, string>;
type LinkColumn = (typeof LINK_COLUMN)[NoteLinkEntityType];
const LINK_COLUMNS = Object.entries(LINK_COLUMN) as [NoteLinkEntityType, LinkColumn][];

const INCLUDE = {
  author: { select: { id: true, name: true, imageUrl: true } },
  links: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  attachments: { include: { file: true } },
} satisfies Prisma.NoteInclude;

type NoteRow = Prisma.NoteGetPayload<{ include: typeof INCLUDE }>;

const targetData = (target: NoteLinkTarget): Record<LinkColumn, string | undefined> =>
  ({ [LINK_COLUMN[target.entityType]]: target.entityId }) as Record<LinkColumn, string | undefined>;

function toLinks(row: NoteRow): NoteLinkTarget[] {
  return row.links.flatMap((link) => {
    const found = LINK_COLUMNS.find(([, column]) => link[column] !== null);
    return found ? [{ entityType: found[0], entityId: link[found[1]] as string }] : [];
  });
}

function toRecord(row: NoteRow): NoteRecord {
  const attachments: NoteFile[] = row.attachments
    .map((attachment) => attachment.file)
    .filter((file) => file.deletedAt === null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    .map((file) => ({
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      status: file.status,
      uploadedById: file.uploadedById,
      createdAt: file.createdAt,
    }));
  return {
    id: row.id,
    title: row.title,
    content: row.content as unknown as RichTextDoc,
    contentText: row.contentText,
    author: { id: row.author.id, name: row.author.name, imageUrl: row.author.imageUrl },
    pinned: row.pinned,
    links: toLinks(row),
    attachments,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

const asJson = (doc: RichTextDoc): Prisma.InputJsonValue => doc as unknown as Prisma.InputJsonValue;

/** Sort map of one request: `pinned` is the feed order (pinned, then creation, both in the direction). */
function sortMapFor(direction: SortSpec['direction']): SortMap {
  const dir = Prisma.raw(direction === 'asc' ? 'ASC' : 'DESC');
  return {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    title: { path: 'title', nullable: true },
    pinned: { path: 'pinned', sql: Prisma.sql`"pinned" ${dir}, "createdAt"` },
  };
}

function prismaWhere(c: NoteListCriteria): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (c.authorIds.length > 0) and.push({ authorId: { in: [...c.authorIds] } });
  if (c.tagIds.length > 0) and.push({ tags: { some: { tagId: { in: [...c.tagIds] } } } });
  if (c.linkedEntityTypes.length > 0) {
    and.push({
      OR: c.linkedEntityTypes.map((type) => ({
        links: { some: { [LINK_COLUMN[type]]: { not: null } } },
      })),
    });
  }
  if (c.entity) {
    and.push({ links: { some: { [LINK_COLUMN[c.entity.entityType]]: c.entity.entityId } } });
  }
  if (c.pinned !== null) and.push({ pinned: c.pinned });
  if (c.createdFrom) and.push({ createdAt: { gte: c.createdFrom } });
  if (c.createdBefore) and.push({ createdAt: { lt: c.createdBefore } });
  return and.length > 0 ? { AND: and } : {};
}

/** The same filters over the unaliased columns of `"Note"`, for the statements that page a search. */
function sqlWhere(c: NoteListCriteria): Prisma.Sql | undefined {
  const parts: Prisma.Sql[] = [];
  if (c.authorIds.length > 0) {
    parts.push(Prisma.sql`"authorId" IN (${Prisma.join([...c.authorIds])})`);
  }
  if (c.tagIds.length > 0) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "TagAssignment" ta WHERE ta."noteId" = "Note"."id" AND ta."tagId" IN (${Prisma.join([...c.tagIds])}))`,
    );
  }
  if (c.linkedEntityTypes.length > 0) {
    const anyOf = c.linkedEntityTypes.map(
      (type) => Prisma.sql`nl.${Prisma.raw(`"${LINK_COLUMN[type]}"`)} IS NOT NULL`,
    );
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "NoteLink" nl WHERE nl."noteId" = "Note"."id" AND (${Prisma.join(anyOf, ' OR ')}))`,
    );
  }
  if (c.entity) {
    const column = Prisma.raw(`"${LINK_COLUMN[c.entity.entityType]}"`);
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "NoteLink" nl WHERE nl."noteId" = "Note"."id" AND nl.${column} = ${c.entity.entityId})`,
    );
  }
  if (c.pinned !== null) parts.push(Prisma.sql`"pinned" = ${c.pinned}`);
  if (c.createdFrom) parts.push(Prisma.sql`"createdAt" >= ${c.createdFrom}`);
  if (c.createdBefore) parts.push(Prisma.sql`"createdAt" < ${c.createdBefore}`);
  return parts.length > 0 ? Prisma.join(parts, ' AND ') : undefined;
}

/**
 * `Note`, `NoteLink` and `NoteAttachment` through the current transaction. `findUnique` is not covered by
 * the soft-delete extension, so by-id reads return archived notes and the use cases decide (C19).
 */
@Injectable()
export class PrismaNoteRepository implements NoteRepository {
  constructor(private readonly host: TransactionHost) {}

  async insert(note: NewNote): Promise<void> {
    const db = this.host.db;
    await db.note.create({
      data: {
        id: note.id,
        title: note.title,
        content: asJson(note.content),
        contentText: note.contentText,
        authorId: note.authorId,
        pinned: note.pinned,
        createdAt: note.createdAt,
        updatedAt: note.createdAt,
      },
    });
    // One millisecond apart so the creation order of the links (the first client is the activity scope) is exact.
    let offset = 0;
    for (const target of note.links) {
      await db.noteLink.create({
        data: {
          noteId: note.id,
          ...targetData(target),
          createdAt: new Date(note.createdAt.getTime() + offset++),
        },
      });
    }
    if (note.attachmentFileIds.length > 0) {
      await db.noteAttachment.createMany({
        data: note.attachmentFileIds.map((fileId) => ({ noteId: note.id, fileId })),
      });
    }
  }

  async findById(id: string): Promise<NoteRecord | null> {
    const row = await this.host.db.note.findUnique({ where: { id }, include: INCLUDE });
    return row ? toRecord(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<NoteRecord | null> {
    const tx = this.host.requireTransaction('NoteRepository.findByIdForUpdate');
    // Blocks while another transaction holds the row; the read after it sees what that one committed.
    await tx.$queryRaw`SELECT "id" FROM "Note" WHERE "id" = ${id} FOR UPDATE`;
    return this.findById(id);
  }

  async list(criteria: NoteListCriteria): Promise<Paginated<NoteRecord>> {
    const db = this.host.db;
    const { query } = criteria;
    const sort = query.sort ?? { field: 'createdAt', direction: 'desc' as const };
    const where = prismaWhere(criteria);
    const filtersSql = sqlWhere(criteria);
    const direction = sort.direction;
    const page = await listPage(db, {
      table: 'Note',
      searchEntryType: 'NOTE',
      sortMap: sortMapFor(direction),
      defaultSort: { field: 'createdAt', direction: 'desc' },
      where,
      ...(filtersSql ? { sqlWhere: filtersSql } : {}),
      query: { ...query, sort },
      find: ({ where: finalWhere, orderBy, skip, take }) =>
        db.note.findMany({
          where: finalWhere,
          orderBy:
            sort.field === 'pinned'
              ? [{ pinned: direction }, { createdAt: direction }, { id: 'asc' }]
              : (orderBy as Prisma.NoteOrderByWithRelationInput[]),
          skip,
          take,
          include: INCLUDE,
        }),
      count: ({ where: finalWhere }) => db.note.count({ where: finalWhere }),
    });
    return { ...page, items: page.items.map(toRecord) };
  }

  async updateContent(id: string, update: NoteContentUpdate): Promise<void> {
    await this.host.db.note.update({
      where: { id },
      data: {
        title: update.title,
        content: asJson(update.content),
        contentText: update.contentText,
        updatedAt: update.updatedAt,
      },
    });
  }

  async setPinned(id: string, pinned: boolean, updatedAt: Date): Promise<void> {
    await this.host.db.note.update({ where: { id }, data: { pinned, updatedAt } });
  }

  async addLink(id: string, target: NoteLinkTarget, at: Date): Promise<void> {
    try {
      await this.host.db.noteLink.create({
        data: { noteId: id, ...targetData(target), createdAt: at },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError({ message: NOTE_ALREADY_LINKED_KEY });
      }
      throw error;
    }
    await this.host.db.note.update({ where: { id }, data: { updatedAt: at } });
  }

  async removeLink(id: string, target: NoteLinkTarget, at: Date): Promise<boolean> {
    const result = await this.host.db.noteLink.deleteMany({
      where: { noteId: id, [LINK_COLUMN[target.entityType]]: target.entityId },
    });
    if (result.count === 0) return false;
    await this.host.db.note.update({ where: { id }, data: { updatedAt: at } });
    return true;
  }

  async addAttachments(id: string, fileIds: readonly string[], at: Date): Promise<void> {
    if (fileIds.length > 0) {
      await this.host.db.noteAttachment.createMany({
        data: fileIds.map((fileId) => ({ noteId: id, fileId })),
        skipDuplicates: true,
      });
    }
    await this.host.db.note.update({ where: { id }, data: { updatedAt: at } });
  }

  async archive(id: string, at: Date, byUserId: string): Promise<void> {
    await this.host.db.note.update({
      where: { id },
      data: { deletedAt: at, deletedById: byUserId },
    });
  }

  async restore(id: string, at: Date): Promise<void> {
    await this.host.db.note.update({
      where: { id },
      data: { deletedAt: null, deletedById: null, updatedAt: at },
    });
  }

  async isFileAttachedToLiveNote(fileId: string): Promise<boolean> {
    const count = await this.host.db.noteAttachment.count({
      where: { fileId, note: { deletedAt: null } },
    });
    return count > 0;
  }
}
