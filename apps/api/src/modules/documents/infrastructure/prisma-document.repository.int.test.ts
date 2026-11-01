import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  catalogIds,
  seedAccount,
  seedClient,
  seedExpense,
  seedInvoice,
  seedPayment,
  seedProject,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../shared/domain/list-query';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  DocumentListCriteria,
  NewDocument,
} from '../application/ports/document.repository.port';
import { PrismaDocumentRepository } from './prisma-document.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaDocumentRepository(host);

const T0 = new Date('2026-10-30T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const TODAY = '2026-10-30';

let userId = '';

const newDocument = (id: string, over: Partial<NewDocument> = {}): NewDocument => ({
  id,
  code: `DOC-${id}`,
  title: `Documento ${id}`,
  typeId: 'ty_sig',
  summary: null,
  status: 'BORRADOR',
  draftContent: null,
  draftUpdatedAt: null,
  currentVersionId: null,
  effectiveDate: null,
  signedAt: null,
  expiresAt: null,
  alertDaysBefore: 30,
  createdAt: T0,
  createdById: userId,
  ...over,
});

type CriteriaOverrides = Partial<Omit<DocumentListCriteria, 'query'>> & {
  query?: Partial<ListQuery>;
};
const criteria = (over: CriteriaOverrides = {}): DocumentListCriteria => {
  const { query, ...rest } = over;
  return {
    statuses: [],
    categoryIds: [],
    typeIds: [],
    formats: [],
    clientIds: [],
    contactIds: [],
    projectIds: [],
    invoiceIds: [],
    paymentIds: [],
    expenseIds: [],
    tagIds: [],
    expiresFrom: null,
    expiresTo: null,
    expiring: null,
    staleBefore: null,
    shared: null,
    today: TODAY,
    ...rest,
    query: { ...DEFAULT_LIST_QUERY, sort: { field: 'code', direction: 'asc' }, ...query },
  };
};
const ids = (page: { items: { id: string }[] }) => page.items.map((d) => d.id);
/** One `SearchEntry` row, the way `DocumentSupport.reindex` leaves it (the list `q` reads these). */
const seedSearchEntry = (
  _db: unknown,
  entry: {
    entityId: string;
    code: string;
    title: string;
    subtitle: string | null;
    body: string | null;
    archived?: boolean;
  },
) =>
  admin.searchEntry.create({
    data: { entityType: 'DOCUMENT', archived: false, ...entry },
  });
const save = (doc: NewDocument) => uow.run(() => repository.insert(doc));
const link = (
  documentId: string,
  entityType: 'CLIENT' | 'CONTACT' | 'PROJECT' | 'INVOICE' | 'PAYMENT' | 'EXPENSE',
  entityId: string,
  minutes = 0,
) =>
  uow.run(() =>
    repository.addLink(
      documentId,
      { entityType, entityId },
      {
        id: `lnk_${documentId}_${entityType}_${entityId}`,
        createdAt: at(minutes),
        createdById: userId,
      },
    ),
  );

beforeAll(async () => {
  await truncateBusinessTables(admin);
  for (const [id, name, order] of [
    ['cat_a', 'Legal', 0],
    ['cat_b', 'Técnico', 1],
  ] as const) {
    await admin.documentCategory.create({ data: { id, name, order } });
  }
  await admin.documentType.createMany({
    data: [
      {
        id: 'ty_sig',
        categoryId: 'cat_a',
        name: 'NDA',
        requiresSignature: true,
        hasExpiration: true,
        defaultFormat: 'ARCHIVO',
      },
      { id: 'ty_md', categoryId: 'cat_b', name: 'Nota', defaultFormat: 'MARKDOWN' },
    ],
  });
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await admin.documentType.deleteMany({ where: { id: { in: ['ty_sig', 'ty_md'] } } });
  await admin.documentCategory.deleteMany({ where: { id: { in: ['cat_a', 'cat_b'] } } });
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  userId = (
    await admin.user.create({
      data: { clerkId: 'user_doc', email: 'doc@example.test', name: 'Autora', role: 'OWNER' },
    })
  ).id;
}, 60_000);

describe('PrismaDocumentRepository: rows', () => {
  it('round-trips a document, its business dates and nullable columns', async () => {
    await save(
      newDocument('d1', {
        summary: 'Resumen',
        effectiveDate: '2026-10-01',
        signedAt: '2026-10-08',
        expiresAt: '2027-10-01',
        alertDaysBefore: 15,
      }),
    );
    expect(await repository.findById('d1')).toEqual({
      id: 'd1',
      code: 'DOC-d1',
      title: 'Documento d1',
      typeId: 'ty_sig',
      summary: 'Resumen',
      status: 'BORRADOR',
      draftContent: null,
      draftUpdatedAt: null,
      currentVersionId: null,
      effectiveDate: '2026-10-01',
      signedAt: '2026-10-08',
      expiresAt: '2027-10-01',
      alertDaysBefore: 15,
      createdAt: T0,
      updatedAt: T0,
      createdById: userId,
      deletedAt: null,
    });
    expect(await repository.findById('missing')).toBeNull();
    const row = await admin.document.findUniqueOrThrow({ where: { id: 'd1' } });
    expect(row.updatedById).toBe(userId);
  });

  it('updates metadata and status, archives and restores, returning archived rows by id', async () => {
    await save(newDocument('d1', { expiresAt: '2027-01-01' }));
    await uow.run(async () => {
      await repository.updateMeta('d1', {
        title: 'Nuevo',
        typeId: 'ty_md',
        summary: 'S',
        effectiveDate: '2026-10-02',
        signedAt: null,
        expiresAt: null,
        alertDaysBefore: 7,
        updatedAt: at(5),
        updatedById: userId,
      });
      await repository.setStatus('d1', {
        status: 'FIRMADO',
        signedAt: '2026-10-08',
        updatedAt: at(6),
        updatedById: userId,
      });
    });
    expect(await repository.findById('d1')).toMatchObject({
      title: 'Nuevo',
      typeId: 'ty_md',
      summary: 'S',
      effectiveDate: '2026-10-02',
      signedAt: '2026-10-08',
      expiresAt: null,
      alertDaysBefore: 7,
      status: 'FIRMADO',
      updatedAt: at(6),
    });

    await uow.run(() => repository.archive(['d1'], at(10), userId));
    expect(await repository.findById('d1')).toMatchObject({ deletedAt: at(10), updatedAt: at(10) });
    expect((await admin.document.findUniqueOrThrow({ where: { id: 'd1' } })).deletedById).toBe(
      userId,
    );

    await uow.run(() => repository.restore('d1', at(20), userId));
    expect(await repository.findById('d1')).toMatchObject({ deletedAt: null, updatedAt: at(20) });
    expect(
      (await admin.document.findUniqueOrThrow({ where: { id: 'd1' } })).deletedById,
    ).toBeNull();
  });

  it('archives several documents in one statement and rolls back with the unit of work', async () => {
    await save(newDocument('d1'));
    await save(newDocument('d2'));
    await expect(
      uow.run(async () => {
        await repository.archive(['d1', 'd2'], at(1), userId);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await admin.document.count({ where: { deletedAt: { not: null } } })).toBe(0);
    await uow.run(() => repository.archive(['d1', 'd2'], at(1), userId));
    expect(await admin.document.count({ where: { deletedAt: { not: null } } })).toBe(2);
  });

  it('labels documents, archived ones flagged and unknown ones absent', async () => {
    await save(newDocument('d1'));
    await save(newDocument('d2'));
    await uow.run(() => repository.archive(['d2'], at(1), userId));
    const labels = await repository.labels(['d1', 'd2', 'nope']);
    expect([...labels]).toEqual([
      ['d1', { code: 'DOC-d1', title: 'Documento d1', archived: false }],
      ['d2', { code: 'DOC-d2', title: 'Documento d2', archived: true }],
    ]);
    expect((await repository.labels([])).size).toBe(0);
  });

  it('lists the ids the expiry step may mark: live, not ANULADO or VENCIDO, expired before today', async () => {
    await save(newDocument('a', { expiresAt: '2026-10-29' }));
    await save(newDocument('b', { expiresAt: '2026-10-30' }));
    await save(newDocument('c', { expiresAt: '2026-01-01', status: 'ANULADO' }));
    await save(newDocument('d', { expiresAt: '2026-01-01', status: 'VENCIDO' }));
    await save(newDocument('e', { expiresAt: '2026-01-01', status: 'FIRMADO' }));
    await save(newDocument('f', { expiresAt: '2026-01-01' }));
    await uow.run(() => repository.archive(['f'], at(1), userId));
    await save(newDocument('g'));
    expect(await repository.expiredIds(TODAY)).toEqual(['a', 'e']);
  });
});

describe('PrismaDocumentRepository: links', () => {
  it('adds a link once (a repeat writes nothing and does not abort the transaction) and removes it', async () => {
    await save(newDocument('d1'));
    const { id } = await uow.run(async () => ({ id: (await seedClient(host.db, 'cli_a')).id }));
    expect(await link('d1', 'CLIENT', id, 1)).toBe(true);
    await uow.run(async () => {
      expect(
        await repository.addLink(
          'd1',
          { entityType: 'CLIENT', entityId: id },
          {
            id: 'lnk_dup',
            createdAt: at(2),
            createdById: userId,
          },
        ),
      ).toBe(false);
      // The transaction is still usable after the repeated insert.
      await repository.setStatus('d1', {
        status: 'EN_REVISION',
        signedAt: null,
        updatedAt: at(3),
        updatedById: userId,
      });
    });
    expect(await repository.links('d1')).toEqual([
      {
        id: 'lnk_d1_CLIENT_cli_a',
        target: { entityType: 'CLIENT', entityId: 'cli_a' },
        createdAt: at(1),
      },
    ]);
    expect(await admin.documentLink.count()).toBe(1);

    expect(
      await uow.run(() => repository.removeLink('d1', { entityType: 'CLIENT', entityId: id })),
    ).toBe(true);
    expect(
      await uow.run(() => repository.removeLink('d1', { entityType: 'CLIENT', entityId: id })),
    ).toBe(false);
    expect(await repository.links('d1')).toEqual([]);
  });

  it('keeps the six target types in creation order', async () => {
    await save(newDocument('d1'));
    await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await seedProject(host.db, 'pry_a', ['cli_a']);
      await seedAccount(host.db, 'acc_a');
      const catalog = await catalogIds(host.db);
      await seedInvoice(host.db, {
        id: 'inv_a',
        clientId: 'cli_a',
        lines: [{ id: 'lin_a', projectId: 'pry_a', unitPrice: '100.00', ivaRate: '16' }],
      });
      await seedPayment(host.db, {
        id: 'pay_a',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId: catalog.methodId,
        amount: '50.00',
      });
      await seedExpense(host.db, { id: 'exp_a', categoryId: catalog.categoryId, amount: '10.00' });
      await host.db.contact.create({
        data: {
          id: 'con_a',
          clientId: 'cli_a',
          fullName: 'Ana Pérez',
          email: 'ana@example.test',
        },
      });
    });
    const targets = [
      ['PROJECT', 'pry_a'],
      ['CONTACT', 'con_a'],
      ['CLIENT', 'cli_a'],
      ['EXPENSE', 'exp_a'],
      ['PAYMENT', 'pay_a'],
      ['INVOICE', 'inv_a'],
    ] as const;
    for (const [index, [type, id]] of targets.entries()) await link('d1', type, id, index);
    expect(
      (await repository.links('d1')).map((l) => `${l.target.entityType}:${l.target.entityId}`),
    ).toEqual(targets.map(([type, id]) => `${type}:${id}`));
  });
});

describe('PrismaDocumentRepository: versions', () => {
  it('appends version N+1, makes it current and exposes the markdown for the search body', async () => {
    await save(newDocument('d1', { typeId: 'ty_md' }));
    const first = await uow.run(() =>
      repository.appendVersion({
        id: 'ver_1',
        documentId: 'd1',
        format: 'MARKDOWN',
        content: '# Uno',
        fileId: null,
        url: null,
        changelog: 'Primera',
        createdAt: at(1),
        createdById: userId,
      }),
    );
    const second = await uow.run(() =>
      repository.appendVersion({
        id: 'ver_2',
        documentId: 'd1',
        format: 'MARKDOWN',
        content: '# Dos',
        fileId: null,
        url: null,
        changelog: null,
        createdAt: at(2),
        createdById: userId,
      }),
    );
    expect([first.versionNumber, second.versionNumber]).toEqual([1, 2]);
    expect(await repository.findById('d1')).toMatchObject({
      currentVersionId: 'ver_2',
      updatedAt: at(2),
    });
    expect(await repository.currentMarkdown('d1')).toBe('# Dos');
  });

  it('answers no markdown for a file or link version, and tells which files versions already hold', async () => {
    await save(newDocument('d1'));
    await admin.file.create({
      data: {
        id: 'fil_a',
        storageKey: 'general/2026/10/fil_a',
        bucket: 'test',
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        status: 'READY',
        uploadedById: userId,
      },
    });
    expect(await repository.isFileHeldByVersion('fil_a')).toBe(false);
    await uow.run(() =>
      repository.appendVersion({
        id: 'ver_1',
        documentId: 'd1',
        format: 'ARCHIVO',
        content: null,
        fileId: 'fil_a',
        url: null,
        changelog: null,
        createdAt: at(1),
        createdById: userId,
      }),
    );
    expect(await repository.isFileHeldByVersion('fil_a')).toBe(true);
    expect(await repository.currentMarkdown('d1')).toBeNull();
    expect(await repository.currentMarkdown('missing')).toBeNull();
  });

  it('allows the same file in two versions of one document (DT-136: restoring a version reuses its file)', async () => {
    await save(newDocument('d1'));
    await admin.file.create({
      data: {
        id: 'fil_a',
        storageKey: 'general/2026/10/fil_a',
        bucket: 'test',
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        status: 'READY',
        uploadedById: userId,
      },
    });
    for (const [index, id] of ['ver_1', 'ver_2'].entries()) {
      await uow.run(() =>
        repository.appendVersion({
          id,
          documentId: 'd1',
          format: 'ARCHIVO',
          content: null,
          fileId: 'fil_a',
          url: null,
          changelog: null,
          createdAt: at(index + 1),
          createdById: userId,
        }),
      );
    }
    expect(await admin.documentVersion.count({ where: { fileId: 'fil_a' } })).toBe(2);
  });
});

describe('PrismaDocumentRepository: relations', () => {
  it('returns the current version with file metadata only, the author, links, count and shared state', async () => {
    await save(newDocument('d1'));
    await save(newDocument('d2'));
    await admin.file.create({
      data: {
        id: 'fil_a',
        storageKey: 'general/2026/10/secret-key',
        bucket: 'private-bucket',
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
        status: 'READY',
        uploadedById: userId,
        createdAt: at(0),
      },
    });
    const file = (id: string) => ({
      id,
      format: 'ARCHIVO' as const,
      content: null,
      fileId: 'fil_a',
      url: null,
      changelog: 'v',
      createdAt: at(1),
      createdById: userId,
    });
    await uow.run(async () => {
      await repository.appendVersion({ ...file('ver_1'), documentId: 'd1' });
      await repository.appendVersion({ ...file('ver_2'), documentId: 'd1' });
      await seedClient(host.db, 'cli_a');
    });
    await link('d1', 'CLIENT', 'cli_a', 1);

    const live = await admin.shareLink.create({
      data: {
        token: 't_live',
        title: 'Live',
        createdById: userId,
        documents: { create: [{ documentId: 'd1' }] },
      },
    });
    expect(live.id).toBeTruthy();

    const relations = await repository.relationsOf(['d1', 'd2', 'missing'], TODAY);

    expect([...relations.keys()].sort()).toEqual(['d1', 'd2']);
    const d1 = relations.get('d1');
    expect(d1).toMatchObject({
      versionCount: 2,
      isShared: true,
      createdBy: { id: userId, name: 'Autora', imageUrl: null },
      currentVersion: {
        id: 'ver_2',
        versionNumber: 2,
        format: 'ARCHIVO',
        changelog: 'v',
        createdBy: { id: userId, name: 'Autora' },
      },
    });
    expect(d1?.currentVersion?.file).toEqual({
      id: 'fil_a',
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      status: 'READY',
      uploadedById: userId,
      createdAt: at(0),
    });
    expect(JSON.stringify(d1)).not.toContain('secret-key');
    expect(JSON.stringify(d1)).not.toContain('private-bucket');
    expect(d1?.links.map((l) => l.target.entityId)).toEqual(['cli_a']);
    expect(relations.get('d2')).toMatchObject({
      versionCount: 0,
      isShared: false,
      currentVersion: null,
      links: [],
    });
    expect((await repository.relationsOf([], TODAY)).size).toBe(0);
  });

  it('derives the share state from revocation and the Caracas day (choice 7)', async () => {
    await save(newDocument('d1'));
    const share = (token: string, over: { revokedAt?: Date; expiresAt?: Date }) =>
      admin.shareLink.create({
        data: {
          token,
          title: token,
          createdById: userId,
          ...over,
          documents: { create: [{ documentId: 'd1' }] },
        },
      });
    const shared = async () => (await repository.relationsOf(['d1'], TODAY)).get('d1')?.isShared;

    await share('t_revoked', { revokedAt: at(1) });
    await share('t_expired', { expiresAt: new Date('2026-10-29') });
    expect(await shared()).toBe(false);
    await share('t_last_day', { expiresAt: new Date('2026-10-30') });
    expect(await shared()).toBe(true);
  });

  it('shows an author whose user row is soft-deleted', async () => {
    const gone = await admin.user.create({
      data: {
        clerkId: 'user_gone',
        email: 'gone@example.test',
        name: 'Antigua',
        role: 'MEMBER',
        deletedAt: at(0),
      },
    });
    await save(newDocument('d1', { createdById: gone.id }));
    expect((await repository.relationsOf(['d1'], TODAY)).get('d1')?.createdBy).toMatchObject({
      id: gone.id,
      name: 'Antigua',
    });
  });
});

describe('PrismaDocumentRepository: list', () => {
  async function seedSet() {
    await save(
      newDocument('a', {
        title: 'Alfa NDA',
        code: 'DOC-0001',
        expiresAt: '2026-11-15',
        createdAt: at(1),
      }),
    );
    await save(
      newDocument('b', { title: 'Beta nota', code: 'DOC-0002', typeId: 'ty_md', createdAt: at(2) }),
    );
    await save(
      newDocument('c', {
        title: 'Gamma contrato',
        code: 'DOC-0003',
        status: 'ENVIADO',
        expiresAt: '2027-06-01',
        createdAt: at(3),
      }),
    );
    await save(newDocument('z', { title: 'Archivado', code: 'DOC-0004', createdAt: at(4) }));
    await uow.run(() => repository.archive(['z'], at(30), userId));
  }

  it('pages in SQL with a total over the whole set and sorts by every API field', async () => {
    await seedSet();
    const first = await repository.list(criteria({ query: { pageSize: 25 } }));
    expect(ids(first)).toEqual(['a', 'b', 'c']);
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });

    const sorts: [string, 'asc' | 'desc', string[]][] = [
      ['code', 'desc', ['c', 'b', 'a']],
      ['title', 'asc', ['a', 'b', 'c']],
      ['category', 'asc', ['a', 'c', 'b']],
      ['type', 'asc', ['a', 'c', 'b']],
      ['status', 'asc', ['a', 'b', 'c']],
      ['expiresAt', 'asc', ['a', 'c', 'b']],
      ['expiresAt', 'desc', ['c', 'a', 'b']],
      ['createdAt', 'desc', ['c', 'b', 'a']],
      ['updatedAt', 'asc', ['a', 'b', 'c']],
      ['format', 'asc', ['a', 'b', 'c']],
      ['versionNumber', 'desc', ['a', 'b', 'c']],
    ];
    for (const [field, direction, expected] of sorts) {
      const page = await repository.list(criteria({ query: { sort: { field, direction } } }));
      expect(ids(page), `${field} ${direction}`).toEqual(expected);
    }
  });

  it('sorts by the current version, NULLs last both ways', async () => {
    await seedSet();
    await uow.run(async () => {
      await repository.appendVersion({
        id: 'v_a1',
        documentId: 'a',
        format: 'MARKDOWN',
        content: 'x',
        fileId: null,
        url: null,
        changelog: null,
        createdAt: at(5),
        createdById: userId,
      });
      await repository.appendVersion({
        id: 'v_a2',
        documentId: 'a',
        format: 'MARKDOWN',
        content: 'y',
        fileId: null,
        url: null,
        changelog: null,
        createdAt: at(6),
        createdById: userId,
      });
      await repository.appendVersion({
        id: 'v_c1',
        documentId: 'c',
        format: 'ENLACE',
        content: null,
        fileId: null,
        url: 'https://x.test',
        changelog: null,
        createdAt: at(7),
        createdById: userId,
      });
    });
    const by = async (field: string, direction: 'asc' | 'desc') =>
      ids(await repository.list(criteria({ query: { sort: { field, direction } } })));
    expect(await by('versionNumber', 'desc')).toEqual(['a', 'c', 'b']);
    expect(await by('versionNumber', 'asc')).toEqual(['c', 'a', 'b']);
    expect(await by('format', 'asc')).toEqual(['c', 'a', 'b']);
    expect(ids(await repository.list(criteria({ formats: ['MARKDOWN'] })))).toEqual(['a']);
  });

  it('pages: the second page holds the rest and the total counts the whole set', async () => {
    for (let i = 1; i <= 27; i++) {
      await save(
        newDocument(`p${String(i).padStart(2, '0')}`, {
          code: `DOC-${String(i).padStart(4, '0')}`,
        }),
      );
    }
    const first = await repository.list(criteria({ query: { page: 1, pageSize: 25 } }));
    const second = await repository.list(criteria({ query: { page: 2, pageSize: 25 } }));
    expect(first.items).toHaveLength(25);
    expect(ids(second)).toEqual(['p26', 'p27']);
    expect(second).toMatchObject({ total: 27, page: 2, pageCount: 2 });
  });

  it('filters by status, type, category, tag and the expiry facets', async () => {
    await seedSet();
    await admin.tag.create({ data: { id: 'tag_a', name: 'Urgente', color: '#112233' } });
    await admin.tagAssignment.create({ data: { tagId: 'tag_a', documentId: 'a' } });
    const only = async (over: CriteriaOverrides) => ids(await repository.list(criteria(over)));

    expect(await only({ statuses: ['ENVIADO'] })).toEqual(['c']);
    expect(await only({ statuses: ['ENVIADO', 'BORRADOR'] })).toEqual(['a', 'b', 'c']);
    expect(await only({ typeIds: ['ty_md'] })).toEqual(['b']);
    expect(await only({ categoryIds: ['cat_a'] })).toEqual(['a', 'c']);
    expect(await only({ tagIds: ['tag_a'] })).toEqual(['a']);
    expect(await only({ expiresFrom: '2027-01-01' })).toEqual(['c']);
    expect(await only({ expiresTo: '2026-12-31' })).toEqual(['a']);
    expect(await only({ expiring: { from: TODAY, to: '2026-11-30' } })).toEqual(['a']);
    expect(await only({ expiring: { from: TODAY, to: '2026-11-10' } })).toEqual([]);
    expect(await only({ staleBefore: at(2) })).toEqual(['a']);
  });

  it('excludes ANULADO and VENCIDO from the expiring shortcut', async () => {
    await seedSet();
    await uow.run(() =>
      repository.setStatus('a', {
        status: 'VENCIDO',
        signedAt: null,
        updatedAt: at(9),
        updatedById: null,
      }),
    );
    expect(
      await repository.list(criteria({ expiring: { from: TODAY, to: '2027-12-31' } })).then(ids),
    ).toEqual(['c']);
  });

  it('filters by each of the six link facets', async () => {
    await seedSet();
    await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await seedProject(host.db, 'pry_a', ['cli_a']);
      await seedAccount(host.db, 'acc_a');
      const catalog = await catalogIds(host.db);
      await seedInvoice(host.db, {
        id: 'inv_a',
        clientId: 'cli_a',
        lines: [{ id: 'lin_a', projectId: 'pry_a', unitPrice: '100.00', ivaRate: '16' }],
      });
      await seedPayment(host.db, {
        id: 'pay_a',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId: catalog.methodId,
        amount: '50.00',
      });
      await seedExpense(host.db, { id: 'exp_a', categoryId: catalog.categoryId, amount: '10.00' });
      await host.db.contact.create({
        data: {
          id: 'con_a',
          clientId: 'cli_a',
          fullName: 'Ana Pérez',
          email: 'ana@example.test',
        },
      });
    });
    await link('a', 'CLIENT', 'cli_a');
    await link('a', 'PROJECT', 'pry_a');
    await link('b', 'CONTACT', 'con_a');
    await link('b', 'INVOICE', 'inv_a');
    await link('c', 'PAYMENT', 'pay_a');
    await link('c', 'EXPENSE', 'exp_a');
    await link('c', 'CLIENT', 'cli_a');
    const only = async (over: CriteriaOverrides) => ids(await repository.list(criteria(over)));

    expect(await only({ clientIds: ['cli_a'] })).toEqual(['a', 'c']);
    expect(await only({ projectIds: ['pry_a'] })).toEqual(['a']);
    expect(await only({ contactIds: ['con_a'] })).toEqual(['b']);
    expect(await only({ invoiceIds: ['inv_a'] })).toEqual(['b']);
    expect(await only({ paymentIds: ['pay_a'] })).toEqual(['c']);
    expect(await only({ expenseIds: ['exp_a'] })).toEqual(['c']);
    expect(await only({ clientIds: ['cli_a'], projectIds: ['pry_a'] })).toEqual(['a']);
    expect(await only({ clientIds: ['cli_other'] })).toEqual([]);
  });

  it('filters by shared state', async () => {
    await seedSet();
    await admin.shareLink.create({
      data: {
        token: 't_live',
        title: 'Live',
        createdById: userId,
        documents: { create: [{ documentId: 'a' }] },
      },
    });
    await admin.shareLink.create({
      data: {
        token: 't_rev',
        title: 'Rev',
        createdById: userId,
        revokedAt: at(1),
        documents: { create: [{ documentId: 'b' }] },
      },
    });
    expect(await repository.list(criteria({ shared: true })).then(ids)).toEqual(['a']);
    expect(await repository.list(criteria({ shared: false })).then(ids)).toEqual(['b', 'c']);
  });

  it('honours the archived mode', async () => {
    await seedSet();
    const mode = async (archived: 'exclude' | 'only' | 'include') =>
      ids(await repository.list(criteria({ query: { archived } })));
    expect(await mode('exclude')).toEqual(['a', 'b', 'c']);
    expect(await mode('only')).toEqual(['z']);
    expect(await mode('include')).toEqual(['a', 'b', 'c', 'z']);
  });

  it('searches through SearchEntry: code, title, type name and body, accent- and case-insensitively', async () => {
    await seedSet();
    const entry = (
      entityId: string,
      code: string,
      title: string,
      subtitle: string,
      body: string | null,
      archived = false,
    ) =>
      seedSearchEntry(admin, {
        entityId,
        code,
        title,
        subtitle,
        body,
        archived,
      });
    await entry('a', 'DOC-0001', 'Alfa NDA', 'NDA', 'Cláusula de confidencialidad');
    await entry('b', 'DOC-0002', 'Beta nota', 'Nota técnica', '# Arquitectura');
    await entry('c', 'DOC-0003', 'Gamma contrato', 'NDA', null);
    await entry('z', 'DOC-0004', 'Archivado', 'NDA', null, true);
    const q = async (text: string, archived: 'exclude' | 'include' = 'exclude') =>
      ids(await repository.list(criteria({ query: { q: text, archived } })));

    expect(await q('CLAUSULA')).toEqual(['a']);
    expect(await q('doc-0002')).toEqual(['b']);
    expect(await q('nda')).toEqual(['a', 'c']);
    expect(await q('tecnica')).toEqual(['b']);
    expect(await q('arquitectura')).toEqual(['b']);
    expect(await q('nothing')).toEqual([]);
    // The table's own `deletedAt` decides the archived mode, not the entry's flag.
    expect(await q('archivado')).toEqual([]);
    expect(await q('archivado', 'include')).toEqual(['z']);
    const combined = await repository.list(
      criteria({ statuses: ['ENVIADO'], query: { q: 'nda' } }),
    );
    expect(ids(combined)).toEqual(['c']);
    expect(combined.total).toBe(1);
  });

  it('treats search text as literal (no LIKE wildcards)', async () => {
    await seedSet();
    await seedSearchEntry(admin, {
      entityId: 'a',
      code: 'DOC-0001',
      title: '100% real',
      subtitle: null,
      body: null,
    });
    await seedSearchEntry(admin, {
      entityId: 'b',
      code: 'DOC-0002',
      title: 'cien por ciento',
      subtitle: null,
      body: null,
    });
    expect(await repository.list(criteria({ query: { q: '100%' } })).then(ids)).toEqual(['a']);
    expect(await repository.list(criteria({ query: { q: '%' } })).then(ids)).toEqual(['a']);
  });
});

describe('PrismaDocumentRepository: category counts', () => {
  it('counts live documents per category under every facet but the category, and q applies', async () => {
    await save(newDocument('a', { code: 'DOC-0001' }));
    await save(newDocument('b', { code: 'DOC-0002', typeId: 'ty_md' }));
    await save(newDocument('c', { code: 'DOC-0003', typeId: 'ty_md', status: 'ENVIADO' }));
    await save(newDocument('z', { code: 'DOC-0004' }));
    await uow.run(() => repository.archive(['z'], at(1), userId));

    expect(await repository.countByCategory(criteria())).toEqual({ cat_a: 1, cat_b: 2 });
    expect(await repository.countByCategory(criteria({ categoryIds: ['cat_a'] }))).toEqual({
      cat_a: 1,
      cat_b: 2,
    });
    expect(await repository.countByCategory(criteria({ statuses: ['ENVIADO'] }))).toEqual({
      cat_b: 1,
    });

    await seedSearchEntry(admin, {
      entityId: 'a',
      code: 'DOC-0001',
      title: 'Alfa',
      subtitle: null,
      body: null,
    });
    expect(await repository.countByCategory(criteria({ query: { q: 'alfa' } }))).toEqual({
      cat_a: 1,
    });
    expect(await repository.countByCategory(criteria({ query: { archived: 'only' } }))).toEqual({
      cat_a: 1,
    });
  });
});
