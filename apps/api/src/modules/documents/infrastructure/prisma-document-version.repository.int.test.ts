import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { NewDocumentVersion } from '../application/ports/document.repository.port';
import { PrismaDocumentRepository } from './prisma-document.repository';
import { PrismaDocumentVersionRepository } from './prisma-document-version.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const documents = new PrismaDocumentRepository(host);
const repository = new PrismaDocumentVersionRepository(host);

const T0 = new Date('2026-10-30T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let userId = '';

const version = (id: string, over: Partial<NewDocumentVersion> = {}): NewDocumentVersion => ({
  id,
  documentId: 'd1',
  format: 'MARKDOWN',
  content: `# ${id}`,
  fileId: null,
  url: null,
  changelog: null,
  createdAt: at(1),
  createdById: userId,
  ...over,
});
const append = (v: NewDocumentVersion) => uow.run(() => documents.appendVersion(v));

const seedFile = (id: string) =>
  admin.file.create({
    data: {
      id,
      storageKey: `general/2026/10/${id}`,
      bucket: 'private-bucket',
      originalName: `${id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'READY',
      uploadedById: userId,
    },
  });

beforeAll(async () => {
  await truncateBusinessTables(admin);
  await admin.documentCategory.create({ data: { id: 'cat_a', name: 'Legal', order: 0 } });
  await admin.documentType.create({
    data: { id: 'ty_md', categoryId: 'cat_a', name: 'Nota', defaultFormat: 'MARKDOWN' },
  });
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await admin.documentType.deleteMany({ where: { id: 'ty_md' } });
  await admin.documentCategory.deleteMany({ where: { id: 'cat_a' } });
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  userId = (
    await admin.user.create({
      data: { clerkId: 'user_ver', email: 'ver@example.test', name: 'Autora', role: 'OWNER' },
    })
  ).id;
  await admin.document.create({
    data: { id: 'd1', code: 'DOC-1', title: 'Nota', typeId: 'ty_md', createdById: userId },
  });
}, 60_000);

describe('PrismaDocumentVersionRepository: reads', () => {
  it('lists the history newest first with the author, the current flag and file metadata only', async () => {
    await seedFile('fil_a');
    await append(version('ver_1'));
    await append(version('ver_2', { format: 'ARCHIVO', content: null, fileId: 'fil_a' }));
    await append(version('ver_3', { format: 'ENLACE', content: null, url: 'https://x.test/a' }));

    const rows = await repository.list('d1');

    expect(rows.map((row) => [row.versionNumber, row.format, row.isCurrent])).toEqual([
      [3, 'ENLACE', true],
      [2, 'ARCHIVO', false],
      [1, 'MARKDOWN', false],
    ]);
    expect(rows[0]).toMatchObject({
      url: 'https://x.test/a',
      createdBy: { id: userId, name: 'Autora' },
    });
    expect(rows[0]).not.toHaveProperty('content');
    expect(rows[1]?.file).toEqual({
      id: 'fil_a',
      originalName: 'fil_a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'READY',
      uploadedById: userId,
      createdAt: expect.any(Date),
    });
    expect(JSON.stringify(rows)).not.toContain('private-bucket');
    expect(JSON.stringify(rows)).not.toContain('storageKey');
    expect(await repository.list('d_missing')).toEqual([]);
  });

  it('finds a version only inside its own document, with its content', async () => {
    await append(version('ver_1'));
    await admin.document.create({
      data: { id: 'd2', code: 'DOC-2', title: 'Otra', typeId: 'ty_md', createdById: userId },
    });

    expect(await repository.findInDocument('d1', 'ver_1')).toMatchObject({
      id: 'ver_1',
      versionNumber: 1,
      content: '# ver_1',
      isCurrent: true,
      createdBy: { name: 'Autora' },
    });
    expect(await repository.findInDocument('d2', 'ver_1')).toBeNull();
    expect(await repository.findInDocument('d1', 'ver_missing')).toBeNull();
  });

  it('reports the format of the current version, null while there is none', async () => {
    expect(await repository.currentFormat('d1')).toBeNull();
    await append(version('ver_1'));
    expect(await repository.currentFormat('d1')).toBe('MARKDOWN');
    await append(version('ver_2', { format: 'ENLACE', content: null, url: 'https://x.test/a' }));
    expect(await repository.currentFormat('d1')).toBe('ENLACE');
    expect(await repository.currentFormat('d_missing')).toBeNull();
  });
});

describe('PrismaDocumentVersionRepository: draft', () => {
  it('saves the draft with its time and author, then clears it, leaving the versions alone', async () => {
    await append(version('ver_1'));

    await uow.run(() =>
      repository.saveDraft('d1', { content: '# Borrador', at: at(5), byUserId: userId }),
    );
    expect(await admin.document.findUniqueOrThrow({ where: { id: 'd1' } })).toMatchObject({
      draftContent: '# Borrador',
      draftUpdatedAt: at(5),
      updatedAt: at(5),
      updatedById: userId,
    });

    await uow.run(() => repository.clearDraft('d1'));
    expect(await admin.document.findUniqueOrThrow({ where: { id: 'd1' } })).toMatchObject({
      draftContent: null,
      draftUpdatedAt: null,
    });
    expect(await admin.documentVersion.count({ where: { documentId: 'd1' } })).toBe(1);
  });
});

describe('PrismaDocumentVersionRepository: file claim', () => {
  it('holds true for a file of a version of a live document, also when two versions share it (DT-136)', async () => {
    await seedFile('fil_a');
    await seedFile('fil_loose');
    expect(await repository.isFileOfLiveDocument('fil_a')).toBe(false);

    await append(version('ver_1', { format: 'ARCHIVO', content: null, fileId: 'fil_a' }));
    await append(version('ver_2', { format: 'ARCHIVO', content: null, fileId: 'fil_a' }));
    expect(await admin.documentVersion.count({ where: { fileId: 'fil_a' } })).toBe(2);
    expect(await repository.isFileOfLiveDocument('fil_a')).toBe(true);
    expect(await repository.isFileOfLiveDocument('fil_loose')).toBe(false);
  });

  it('fails closed once the document is archived and opens again when it is restored (A3)', async () => {
    await seedFile('fil_a');
    await append(version('ver_1', { format: 'ARCHIVO', content: null, fileId: 'fil_a' }));

    await uow.run(() => documents.archive(['d1'], at(9), userId));
    expect(await repository.isFileOfLiveDocument('fil_a')).toBe(false);

    await uow.run(() => documents.restore('d1', at(10), userId));
    expect(await repository.isFileOfLiveDocument('fil_a')).toBe(true);
  });
});
