import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaSearchIndex } from '../../../shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaDocumentTypeSearchDependents } from './document-type-search-dependents.adapter';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const dependents = new PrismaDocumentTypeSearchDependents(host, new PrismaSearchIndex(host));

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

async function seedType(id: string, name: string): Promise<void> {
  const category = await admin.documentCategory.findFirstOrThrow();
  await admin.documentType.upsert({
    where: { id },
    update: { name },
    create: { id, name, categoryId: category.id },
  });
}

async function seedDoc(id: string, typeId: string, subtitle: string, deleted = false) {
  await admin.document.create({
    data: {
      id,
      code: `DOC-${id}`,
      title: `Titulo ${id}`,
      typeId,
      deletedAt: deleted ? new Date('2026-10-01T00:00:00Z') : null,
    },
  });
  await admin.searchEntry.create({
    data: {
      entityType: 'DOCUMENT',
      entityId: id,
      code: `DOC-${id}`,
      title: `Titulo ${id}`,
      subtitle,
      body: 'cuerpo intacto',
      status: 'BORRADOR',
      archived: deleted,
    },
  });
}

const subtitles = async () =>
  Object.fromEntries(
    (await admin.searchEntry.findMany({ where: { entityType: 'DOCUMENT' } })).map((e) => [
      e.entityId,
      e.subtitle,
    ]),
  );

beforeEach(async () => {
  await truncateBusinessTables(admin);
  await seedType('dtyp_a', 'Contrato');
  await seedType('dtyp_b', 'Factura');
});

describe('PrismaDocumentTypeSearchDependents.relabelType (DT-166, A15)', () => {
  it('sets the new type name as subtitle on every document of the type, archived included', async () => {
    await seedDoc('doc_1', 'dtyp_a', 'Contrato');
    await seedDoc('doc_2', 'dtyp_a', 'Contrato', true);
    await seedDoc('doc_3', 'dtyp_b', 'Factura');

    const changed = await uow.run(() => dependents.relabelType('dtyp_a', 'Contrato marco'));

    expect(changed).toBe(2);
    expect(await subtitles()).toEqual({
      doc_1: 'Contrato marco',
      doc_2: 'Contrato marco',
      doc_3: 'Factura',
    });
    const entry = await admin.searchEntry.findFirstOrThrow({ where: { entityId: 'doc_2' } });
    expect(entry).toMatchObject({ body: 'cuerpo intacto', archived: true, title: 'Titulo doc_2' });
  });

  it('changes nothing when the name is already there', async () => {
    await seedDoc('doc_1', 'dtyp_a', 'Contrato');
    expect(await uow.run(() => dependents.relabelType('dtyp_a', 'Contrato'))).toBe(0);
  });

  it('skips a document with no entry and a type with no documents', async () => {
    await admin.document.create({
      data: { id: 'doc_free', code: 'DOC-free', title: 'Sin entrada', typeId: 'dtyp_a' },
    });
    expect(await uow.run(() => dependents.relabelType('dtyp_a', 'Otro'))).toBe(0);
    expect(await uow.run(() => dependents.relabelType('dtyp_b', 'Otro'))).toBe(0);
  });

  it('is valid only inside a unit of work', async () => {
    await seedDoc('doc_1', 'dtyp_a', 'Contrato');
    await expect(dependents.relabelType('dtyp_a', 'Nuevo')).rejects.toThrow();
    expect((await subtitles()).doc_1).toBe('Contrato');
  });

  it('rolls back with the unit of work', async () => {
    await seedDoc('doc_1', 'dtyp_a', 'Contrato');
    await expect(
      uow.run(async () => {
        await dependents.relabelType('dtyp_a', 'Nuevo');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await subtitles()).doc_1).toBe('Contrato');
  });
});
