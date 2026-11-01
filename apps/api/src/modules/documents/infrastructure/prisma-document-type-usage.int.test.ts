import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaDocumentTypeUsage } from './prisma-document-type-usage';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const usage = new PrismaDocumentTypeUsage(host);
const uow = new PrismaUnitOfWork(host);

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
});

const document = (id: string, typeId: string, over: Record<string, unknown> = {}) =>
  admin.document.create({ data: { id, code: `DOC-${id}`, title: id, typeId, ...over } });

describe('PrismaDocumentTypeUsage.countDocuments', () => {
  it('counts the documents of the type, archived ones included, and no other type', async () => {
    await document('doc_a', 'dtyp_nda');
    await document('doc_b', 'dtyp_nda', { deletedAt: new Date('2026-10-01T00:00:00.000Z') });
    await document('doc_c', 'dtyp_prd');

    await expect(usage.countDocuments('dtyp_nda')).resolves.toBe(2);
    await expect(usage.countDocuments('dtyp_prd')).resolves.toBe(1);
    await expect(usage.countDocuments('dtyp_credenciales')).resolves.toBe(0);
  });

  it('inside a unit of work it locks the type row, so a competing delete waits', async () => {
    let release!: () => void;
    const mayEnd = new Promise<void>((resolve) => (release = resolve));
    let counted!: () => void;
    const hasCounted = new Promise<void>((resolve) => (counted = resolve));
    const holder = uow.run(async () => {
      await usage.countDocuments('dtyp_credenciales');
      counted();
      await mayEnd;
    });
    await hasCounted;

    const probe = admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DocumentType" WHERE "id" = 'dtyp_credenciales' FOR UPDATE NOWAIT`;
    });
    await expect(probe).rejects.toThrow();

    release();
    await holder;
  });
});
