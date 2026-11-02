import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { DocumentsReindexSource } from './documents-reindex-source';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const source = new DocumentsReindexSource(new TransactionHost(service));

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await admin.user.create({
    data: { id: 'usr_a', clerkId: 'user_ri', email: 'ri@example.test', name: 'A', role: 'OWNER' },
  });
  await admin.documentType.upsert({
    where: { id: 'dtyp_nda' },
    update: { name: 'NDA' },
    create: {
      id: 'dtyp_nda',
      name: 'NDA',
      category: { connect: { id: (await admin.documentCategory.findFirstOrThrow()).id } },
    },
  });
});

async function seedDoc(
  id: string,
  over: {
    summary?: string | null;
    deletedAt?: Date | null;
    version?: 'MARKDOWN' | 'ENLACE' | null;
  } = {},
) {
  await admin.document.create({
    data: {
      id,
      code: `DOC-${id}`,
      title: `Titulo ${id}`,
      typeId: 'dtyp_nda',
      summary: over.summary ?? null,
      status: 'APROBADO',
      deletedAt: over.deletedAt ?? null,
    },
  });
  if (over.version) {
    const version = await admin.documentVersion.create({
      data: {
        id: `${id}_v1`,
        documentId: id,
        versionNumber: 1,
        format: over.version,
        content: over.version === 'MARKDOWN' ? '# Cuerpo\n\ntexto del documento' : null,
        url: over.version === 'ENLACE' ? 'https://example.test/doc' : null,
        createdById: 'usr_a',
      },
    });
    await admin.document.update({ where: { id }, data: { currentVersionId: version.id } });
  }
}

describe('DocumentsReindexSource', () => {
  it('is the DOCUMENT source', () => {
    expect(source.entityType).toBe('DOCUMENT');
  });

  it('pages ids ascending after the cursor, archived documents included', async () => {
    await seedDoc('doc_c');
    await seedDoc('doc_a');
    await seedDoc('doc_b', { deletedAt: new Date('2026-10-01T00:00:00Z') });

    expect(await source.pageIds(null, 2)).toEqual(['doc_a', 'doc_b']);
    expect(await source.pageIds('doc_b', 2)).toEqual(['doc_c']);
    expect(await source.pageIds('doc_c', 2)).toEqual([]);
  });

  it('implies the entry the write path stores: type name as subtitle, summary plus markdown as body', async () => {
    await seedDoc('doc_a', { summary: 'Resumen del NDA', version: 'MARKDOWN' });
    expect(await source.entryOf('doc_a')).toEqual({
      entityType: 'DOCUMENT',
      entityId: 'doc_a',
      code: 'DOC-doc_a',
      title: 'Titulo doc_a',
      subtitle: 'NDA',
      body: 'Resumen del NDA\n\n# Cuerpo\n\ntexto del documento',
      status: 'APROBADO',
      archived: false,
    });
  });

  it('indexes only the summary when the current version is not markdown, and nothing for a bare draft', async () => {
    await seedDoc('doc_link', { summary: 'Solo resumen', version: 'ENLACE' });
    await seedDoc('doc_bare');
    expect((await source.entryOf('doc_link'))?.body).toBe('Solo resumen');
    expect((await source.entryOf('doc_bare'))?.body).toBeNull();
  });

  it('marks an archived document as archived and answers null for a missing one', async () => {
    await seedDoc('doc_old', { deletedAt: new Date('2026-10-01T00:00:00Z') });
    expect((await source.entryOf('doc_old'))?.archived).toBe(true);
    expect(await source.entryOf('doc_gone')).toBeNull();
  });
});
