import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { DocumentType } from '../domain/document-type';
import {
  restoreCatalog,
  snapshotCatalog,
  type CatalogSnapshot,
} from '../../../../test/settings/document-types/catalog-snapshot';
import { PrismaDocumentCategoryRepository } from './prisma-document-category.repository';
import { PrismaDocumentTypeRepository } from './prisma-document-type.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const categories = new PrismaDocumentCategoryRepository(host);
const repository = new PrismaDocumentTypeRepository(host);

const CATEGORY_ID = 'dcat_int_type';
const contrato: DocumentType = {
  id: 'dtyp_int_contrato',
  categoryId: CATEGORY_ID,
  name: 'Contrato de servicios',
  nameEn: 'Service agreement',
  requiresSignature: true,
  hasExpiration: true,
  defaultFormat: 'ARCHIVO',
  active: true,
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
  await uow.run(() =>
    categories.insert({ id: CATEGORY_ID, name: 'Legal', nameEn: null, color: null, order: 0 }),
  );
});
afterAll(async () => {
  await restoreCatalog(admin, seeded);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaDocumentTypeRepository (int)', () => {
  it('stores the capabilities and the format, and reads them back', async () => {
    await uow.run(() => repository.insert(contrato));
    await expect(repository.find(contrato.id)).resolves.toEqual(contrato);
  });

  it('lists every type and finds none for a missing id', async () => {
    await uow.run(() => repository.insert(contrato));
    expect((await repository.list()).map((row) => row.id)).toEqual([contrato.id]);
    await expect(repository.find('dtyp_int_missing')).resolves.toBeNull();
  });

  it('updates every field, including the category, and reads the new values', async () => {
    await uow.run(() => repository.insert(contrato));
    await uow.run(() =>
      repository.update({ ...contrato, nameEn: null, defaultFormat: 'ENLACE', active: false }),
    );
    await expect(repository.find(contrato.id)).resolves.toMatchObject({
      nameEn: null,
      defaultFormat: 'ENLACE',
      active: false,
    });
  });

  it('deletes the row for good', async () => {
    await uow.run(() => repository.insert(contrato));
    await uow.run(() => repository.delete(contrato.id));
    await expect(repository.find(contrato.id)).resolves.toBeNull();
  });

  it('discards the write when the unit of work rolls back', async () => {
    await expect(
      uow.run(async () => {
        await repository.insert(contrato);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(repository.find(contrato.id)).resolves.toBeNull();
  });
});
