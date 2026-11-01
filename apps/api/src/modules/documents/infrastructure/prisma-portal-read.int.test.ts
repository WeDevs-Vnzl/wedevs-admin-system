import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaPortalRead } from './prisma-portal-read';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const read = new PrismaPortalRead(new TransactionHost(service));

let userId = '';

async function document(id: string, over: Record<string, unknown> = {}, versions = 1) {
  await admin.document.create({
    data: {
      id,
      code: `DOC-${id}`,
      title: `Documento ${id}`,
      typeId: 'dtyp_nda',
      status: 'APROBADO',
      createdById: userId,
      ...over,
    },
  });
  for (let n = 1; n <= versions; n += 1) {
    await admin.documentVersion.create({
      data: {
        id: `${id}_v${n}`,
        documentId: id,
        versionNumber: n,
        format: 'MARKDOWN',
        content: `# ${n}`,
        createdAt: new Date(`2026-10-0${n}T15:00:00.000Z`),
        createdById: userId,
      },
    });
  }
  if (versions > 0) {
    await admin.document.update({
      where: { id },
      data: { currentVersionId: `${id}_v${versions}` },
    });
  }
}

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
  userId = (
    await admin.user.create({
      data: { clerkId: 'user_portal', email: 'portal@example.test', name: 'Autora', role: 'OWNER' },
    })
  ).id;
  await admin.shareLink.create({
    data: { id: 'shr_a', token: 'a'.repeat(43), title: 'Enlace', createdById: userId },
  });
});

const link = (documentId: string, order: number, over: Record<string, unknown> = {}) =>
  admin.shareLinkDocument.create({ data: { shareLinkId: 'shr_a', documentId, order, ...over } });

describe('PrismaPortalRead.documentsOf', () => {
  it('leaves out an ANULADO document and keeps a VENCIDO one (DT-151)', async () => {
    await document('doc_a', { status: 'ANULADO' });
    await document('doc_b', { status: 'VENCIDO' });
    await document('doc_c');
    await link('doc_a', 0);
    await link('doc_b', 1);
    await link('doc_c', 2);

    expect((await read.documentsOf('shr_a')).map((row) => row.documentId)).toEqual([
      'doc_b',
      'doc_c',
    ]);
  });

  it('lists the documents in display order with the current version, or the pinned one', async () => {
    await document('doc_a', {}, 3);
    await document('doc_b', {}, 2);
    await link('doc_b', 0, { versionId: 'doc_b_v1' });
    await link('doc_a', 1);

    const rows = await read.documentsOf('shr_a');

    expect(rows.map((row) => row.documentId)).toEqual(['doc_b', 'doc_a']);
    expect(rows[0]).toMatchObject({
      order: 0,
      code: 'DOC-doc_b',
      title: 'Documento doc_b',
      typeId: 'dtyp_nda',
      requiresKey: false,
      version: { id: 'doc_b_v1', versionNumber: 1, format: 'MARKDOWN' },
    });
    expect(rows[1]?.version).toMatchObject({ id: 'doc_a_v3', versionNumber: 3 });
    expect(rows[1]?.version.createdAt).toEqual(new Date('2026-10-03T15:00:00.000Z'));
  });

  it('follows a new version for a latest link and keeps a pinned link on its version', async () => {
    await document('doc_a', {}, 1);
    await link('doc_a', 0, { versionId: 'doc_a_v1' });
    await admin.documentVersion.create({
      data: {
        id: 'doc_a_v2',
        documentId: 'doc_a',
        versionNumber: 2,
        format: 'MARKDOWN',
        content: '# 2',
        createdById: userId,
      },
    });
    await admin.document.update({ where: { id: 'doc_a' }, data: { currentVersionId: 'doc_a_v2' } });
    expect((await read.documentsOf('shr_a'))[0]?.version.id).toBe('doc_a_v1');

    await admin.shareLinkDocument.update({
      where: { shareLinkId_documentId: { shareLinkId: 'shr_a', documentId: 'doc_a' } },
      data: { versionId: null },
    });
    expect((await read.documentsOf('shr_a'))[0]?.version.id).toBe('doc_a_v2');
  });

  it('reports a key as required without returning the hash', async () => {
    await document('doc_a');
    await link('doc_a', 0, { accessKeyHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA' });
    const rows = await read.documentsOf('shr_a');
    expect(rows[0]?.requiresKey).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('scrypt');
  });

  it('leaves out an archived document, a document without a version and a pinned version of another document', async () => {
    await document('doc_ok');
    await document('doc_gone', { deletedAt: new Date('2026-10-05T00:00:00.000Z') });
    await document('doc_empty', {}, 0);
    await document('doc_foreign');
    await document('doc_other');
    await link('doc_ok', 0);
    await link('doc_gone', 1);
    await link('doc_empty', 2);
    await link('doc_foreign', 3, { versionId: 'doc_other_v1' });
    expect((await read.documentsOf('shr_a')).map((row) => row.documentId)).toEqual(['doc_ok']);
  });

  it('is empty for an unknown link and ignores the documents of other links', async () => {
    await document('doc_a');
    await link('doc_a', 0);
    expect(await read.documentsOf('shr_none')).toEqual([]);
  });
});
