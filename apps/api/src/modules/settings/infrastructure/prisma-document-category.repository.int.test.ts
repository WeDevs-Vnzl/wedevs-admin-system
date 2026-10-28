import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { DocumentCategory } from '../domain/document-category';
import {
  restoreCatalog,
  snapshotCatalog,
  type CatalogSnapshot,
} from '../../../../test/settings/document-types/catalog-snapshot';
import { PrismaDocumentCategoryRepository } from './prisma-document-category.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaDocumentCategoryRepository(host);

const legal: DocumentCategory = {
  id: 'dcat_int_b',
  name: 'Legal',
  nameEn: 'Legal',
  color: '#6d28d9',
  order: 1,
};
const tecnico: DocumentCategory = {
  id: 'dcat_int_a',
  name: 'Técnico',
  nameEn: null,
  color: null,
  order: 0,
};

let seeded: CatalogSnapshot;

beforeAll(async () => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
  seeded = await snapshotCatalog(admin);
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await admin.documentType.deleteMany();
  await admin.documentCategory.deleteMany();
});
afterAll(async () => {
  await restoreCatalog(admin, seeded);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaDocumentCategoryRepository (int)', () => {
  it('lists categories ascending by order, and finds none for a missing id', async () => {
    await uow.run(async () => {
      await repository.insert(legal);
      await repository.insert(tecnico);
    });
    expect((await repository.list()).map((row) => row.id)).toEqual(['dcat_int_a', 'dcat_int_b']);
    await expect(repository.find('dcat_int_missing')).resolves.toBeNull();
  });

  it('stores every field as given and reads it back', async () => {
    await uow.run(() => repository.insert(legal));
    await expect(repository.find(legal.id)).resolves.toEqual(legal);
  });

  it('updates the order and the fields of an existing row', async () => {
    await uow.run(() => repository.insert(legal));
    await uow.run(() => repository.update({ ...legal, name: 'Jurídico', nameEn: null, order: 4 }));
    await expect(repository.find(legal.id)).resolves.toMatchObject({
      name: 'Jurídico',
      nameEn: null,
      order: 4,
    });
    await expect(admin.documentCategory.count({ where: { id: legal.id } })).resolves.toBe(1);
  });

  it('deletes the row for good', async () => {
    await uow.run(() => repository.insert(legal));
    await uow.run(() => repository.delete(legal.id));
    await expect(repository.find(legal.id)).resolves.toBeNull();
  });

  it('discards the write when the unit of work rolls back', async () => {
    await expect(
      uow.run(async () => {
        await repository.insert(legal);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(repository.find(legal.id)).resolves.toBeNull();
  });
});
