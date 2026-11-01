import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../shared/domain/list-query';
import type { RichTextDoc } from '../../../shared/domain/rich-text';
import type { NewNote, NoteListCriteria } from '../application/ports/note.repository.port';
import type { NoteLinkTarget } from '../domain/note-link';
import { PrismaNoteRepository } from './prisma-note.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaNoteRepository(host);

const doc = (text: string): RichTextDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const T0 = new Date('2026-10-30T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let authorId = '';
let otherId = '';
let clientId = '';
let contactId = '';
let projectId = '';
let tagId = '';

const link = (entityType: NoteLinkTarget['entityType'], entityId: string): NoteLinkTarget => ({
  entityType,
  entityId,
});

const newNote = (id: string, over: Partial<NewNote> = {}): NewNote => ({
  id,
  title: null,
  content: doc(`texto ${id}`),
  contentText: `texto ${id}`,
  authorId,
  pinned: false,
  links: [link('CLIENT', clientId)],
  attachmentFileIds: [],
  createdAt: T0,
  ...over,
});

type CriteriaOverrides = Partial<Omit<NoteListCriteria, 'query'>> & { query?: Partial<ListQuery> };
const criteria = (over: CriteriaOverrides = {}) => {
  const { query, ...rest } = over;
  return {
    authorIds: [],
    tagIds: [],
    linkedEntityTypes: [],
    entity: null,
    pinned: null,
    createdFrom: null,
    createdBefore: null,
    ...rest,
    query: { ...DEFAULT_LIST_QUERY, sort: { field: 'createdAt', direction: 'desc' }, ...query },
  } satisfies NoteListCriteria;
};
const ids = (page: { items: { id: string }[] }) => page.items.map((n) => n.id);
const save = (note: NewNote) => uow.run(() => repository.insert(note));

async function seedFile(id: string, uploadedById = authorId) {
  return admin.file.create({
    data: {
      id,
      storageKey: `general/2026/10/${id}`,
      bucket: 'test',
      originalName: `${id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'READY',
      uploadedById,
      createdAt: at(Number(id.replace(/\D/g, '') || 0)),
    },
  });
}

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  authorId = (
    await admin.user.create({
      data: { clerkId: 'c_author', email: 'author@example.test', name: 'Author', role: 'MEMBER' },
    })
  ).id;
  otherId = (
    await admin.user.create({
      data: { clerkId: 'c_other', email: 'other@example.test', name: 'Other', role: 'MEMBER' },
    })
  ).id;
  clientId = (
    await admin.client.create({
      data: {
        code: 'CLI-0001',
        kind: 'EMPRESA',
        tradeName: 'Kairos',
        legalName: 'Kairos SA',
        taxId: 'J-1',
        country: 'VE',
        address: 'x',
        phone: '1',
      },
    })
  ).id;
  contactId = (await admin.contact.create({ data: { clientId, fullName: 'Ana' } })).id;
  projectId = (
    await admin.project.create({ data: { code: 'PRY-0001', name: 'Web', summary: 's' } })
  ).id;
  tagId = (await admin.tag.create({ data: { name: 'Urgente', color: '#112233' } })).id;
});
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaNoteRepository (int)', { timeout: 120_000 }, () => {
  it('stores a note with its links in order and its attachments, and reads it back', async () => {
    await seedFile('fil_1');
    await seedFile('fil_2');
    await save(
      newNote('not_a', {
        title: 'Alcance',
        links: [link('PROJECT', projectId), link('CLIENT', clientId), link('CONTACT', contactId)],
        attachmentFileIds: ['fil_2', 'fil_1'],
      }),
    );
    const note = await repository.findById('not_a');
    expect(note).toMatchObject({
      id: 'not_a',
      title: 'Alcance',
      contentText: 'texto not_a',
      pinned: false,
      author: { id: authorId, name: 'Author', imageUrl: null },
      deletedAt: null,
    });
    expect(note?.content).toEqual(doc('texto not_a'));
    expect(note?.createdAt).toEqual(T0);
    expect(note?.links).toEqual([
      link('PROJECT', projectId),
      link('CLIENT', clientId),
      link('CONTACT', contactId),
    ]);
    expect(note?.attachments.map((f) => f.id)).toEqual(['fil_1', 'fil_2']);
    await expect(repository.findById('not_missing')).resolves.toBeNull();
  });

  it('adds and removes links, refusing a repeat with CONFLICT', async () => {
    await save(newNote('not_a'));
    await uow.run(() => repository.addLink('not_a', link('PROJECT', projectId), at(5)));
    await expect(
      uow.run(() => repository.addLink('not_a', link('PROJECT', projectId), at(6))),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'notes.errors.alreadyLinked' });
    expect((await repository.findById('not_a'))?.links).toHaveLength(2);
    expect((await repository.findById('not_a'))?.updatedAt).toEqual(at(5));
    await expect(
      uow.run(() => repository.removeLink('not_a', link('PROJECT', projectId), at(7))),
    ).resolves.toBe(true);
    await expect(
      uow.run(() => repository.removeLink('not_a', link('PROJECT', projectId), at(8))),
    ).resolves.toBe(false);
  });

  it('updates content, pin and attachments (idempotently)', async () => {
    await seedFile('fil_1');
    await save(newNote('not_a'));
    await uow.run(async () => {
      await repository.updateContent('not_a', {
        title: 'Nuevo',
        content: doc('otro'),
        contentText: 'otro',
        updatedAt: at(1),
      });
      await repository.setPinned('not_a', true, at(2));
      await repository.addAttachments('not_a', ['fil_1'], at(3));
      await repository.addAttachments('not_a', ['fil_1'], at(4));
    });
    const note = await repository.findById('not_a');
    expect(note).toMatchObject({ title: 'Nuevo', contentText: 'otro', pinned: true });
    expect(note?.attachments).toHaveLength(1);
    expect(note?.updatedAt).toEqual(at(4));
  });

  it('archives and restores, and only a live note claims its files', async () => {
    await seedFile('fil_1');
    await save(newNote('not_a', { attachmentFileIds: ['fil_1'] }));
    await expect(repository.isFileAttachedToLiveNote('fil_1')).resolves.toBe(true);
    await uow.run(() => repository.archive('not_a', at(1), otherId));
    const archived = await repository.findById('not_a');
    expect(archived?.deletedAt).toEqual(at(1));
    expect(await admin.note.findUnique({ where: { id: 'not_a' } })).toMatchObject({
      deletedById: otherId,
    });
    await expect(repository.isFileAttachedToLiveNote('fil_1')).resolves.toBe(false);
    await uow.run(() => repository.restore('not_a', at(2)));
    const restored = await repository.findById('not_a');
    expect(restored?.deletedAt).toBeNull();
    expect(await admin.note.findUnique({ where: { id: 'not_a' } })).toMatchObject({
      deletedById: null,
    });
    await expect(repository.isFileAttachedToLiveNote('fil_1')).resolves.toBe(true);
    await expect(repository.isFileAttachedToLiveNote('fil_none')).resolves.toBe(false);
  });

  it('locks the row: a second transaction waits for the first to commit', async () => {
    await save(newNote('not_a'));
    const events: string[] = [];
    const first = uow.run(async () => {
      await repository.findByIdForUpdate('not_a');
      events.push('first locked');
      await new Promise((resolve) => setTimeout(resolve, 400));
      events.push('first commits');
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = uow.run(async () => {
      await repository.findByIdForUpdate('not_a');
      events.push('second locked');
    });
    await Promise.all([first, second]);
    expect(events).toEqual(['first locked', 'first commits', 'second locked']);
  });

  it('refuses the row lock outside a unit of work', async () => {
    await save(newNote('not_a'));
    await expect(repository.findByIdForUpdate('not_a')).rejects.toThrow(/unit of work/);
  });

  describe('list', () => {
    async function populate() {
      await save(
        newNote('not_1', {
          title: 'Alcance',
          createdAt: at(1),
          links: [link('CLIENT', clientId), link('PROJECT', projectId)],
        }),
      );
      await save(
        newNote('not_2', {
          authorId: otherId,
          content: doc('Integración de pagos'),
          contentText: 'Integración de pagos',
          createdAt: at(2),
          links: [link('PROJECT', projectId)],
        }),
      );
      await save(
        newNote('not_3', { pinned: true, createdAt: at(3), links: [link('CONTACT', contactId)] }),
      );
      await admin.tagAssignment.create({ data: { tagId, noteId: 'not_2' } });
    }
    const list = (over: CriteriaOverrides = {}) => repository.list(criteria(over));

    it('pages newest first and reports the total', async () => {
      await populate();
      const page = await list({ query: { pageSize: 25 } });
      expect(ids(page)).toEqual(['not_3', 'not_2', 'not_1']);
      expect(page).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
      expect(page.items[2]?.links).toHaveLength(2);
      const asc = await list({ query: { sort: { field: 'createdAt', direction: 'asc' } } });
      expect(ids(asc)).toEqual(['not_1', 'not_2', 'not_3']);
    });

    it('applies every filter, with and without a text search', async () => {
      await populate();
      for (const q of [undefined, 'o']) {
        const base = q ? { query: { q } } : {};
        const expectIds = async (filters: CriteriaOverrides, expected: string[]) => {
          const page = await list({ ...filters, query: { ...base.query, ...filters.query } });
          expect(ids(page).sort()).toEqual(expected.sort());
          expect(page.total).toBe(page.items.length);
        };
        await expectIds({ authorIds: [otherId] }, ['not_2']);
        await expectIds({ tagIds: [tagId] }, ['not_2']);
        await expectIds({ linkedEntityTypes: ['CONTACT'] }, ['not_3']);
        await expectIds({ linkedEntityTypes: ['CONTACT', 'PROJECT'] }, ['not_1', 'not_2', 'not_3']);
        await expectIds({ entity: link('PROJECT', projectId) }, ['not_1', 'not_2']);
        await expectIds({ pinned: true }, ['not_3']);
        await expectIds({ pinned: false }, ['not_1', 'not_2']);
        await expectIds({ createdFrom: at(2), createdBefore: at(3) }, ['not_2']);
      }
    });

    it('searches title and plain text, accent and case insensitive', async () => {
      await populate();
      expect(ids(await list({ query: { q: 'integracion' } }))).toEqual(['not_2']);
      expect(ids(await list({ query: { q: 'ALCANCE' } }))).toEqual(['not_1']);
      expect(ids(await list({ query: { q: 'texto not_3' } }))).toEqual(['not_3']);
      const combined = await list({ pinned: false, query: { q: 'not_' } });
      expect(ids(combined)).toEqual(['not_1']);
      expect(combined.total).toBe(1);
    });

    it('sorts the feed (pinned first, then newest) with and without a search', async () => {
      await populate();
      await uow.run(() => repository.setPinned('not_1', true, at(9)));
      for (const q of [undefined, 'n']) {
        const page = await list({
          query: { sort: { field: 'pinned', direction: 'desc' }, ...(q ? { q } : {}) },
        });
        expect(ids(page)).toEqual(['not_3', 'not_1', 'not_2']);
      }
      const byTitle = await list({ query: { sort: { field: 'title', direction: 'asc' } } });
      expect(ids(byTitle)[0]).toBe('not_1');
    });

    it('follows the archived mode', async () => {
      await populate();
      await uow.run(() => repository.archive('not_2', at(10), authorId));
      expect(ids(await list())).not.toContain('not_2');
      expect(ids(await list({ query: { archived: 'only' } }))).toEqual(['not_2']);
      expect(ids(await list({ query: { archived: 'include' } }))).toHaveLength(3);
      expect(ids(await list({ query: { archived: 'only', q: 'integracion' } }))).toEqual(['not_2']);
    });
  });
});
