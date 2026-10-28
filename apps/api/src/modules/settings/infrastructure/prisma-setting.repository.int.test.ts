import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaSettingRepository } from './prisma-setting.repository';

const KEY = 'company-int-test';
const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaSettingRepository(host);

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(async () => {
  await admin.setting.deleteMany({ where: { key: KEY } });
});
afterAll(async () => {
  await admin.setting.deleteMany({ where: { key: KEY } });
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaSettingRepository (int)', () => {
  it('finds nothing for a missing key', async () => {
    await expect(repository.find(KEY)).resolves.toBeNull();
  });

  it('stores a JSON value and reads it back', async () => {
    const value = { name: 'WeDevs Studio', legalName: null, logoFileId: null };
    await uow.run(() => repository.save(KEY, value));
    await expect(repository.find(KEY)).resolves.toEqual({ key: KEY, value });
  });

  it('replaces the value of an existing key without a second row', async () => {
    await uow.run(() => repository.save(KEY, { name: 'First' }));
    await uow.run(() => repository.save(KEY, { name: 'Second' }));
    await expect(repository.find(KEY)).resolves.toMatchObject({ value: { name: 'Second' } });
    await expect(admin.setting.count({ where: { key: KEY } })).resolves.toBe(1);
  });

  it('discards the write when the unit of work rolls back', async () => {
    await expect(
      uow.run(async () => {
        await repository.save(KEY, { name: 'Lost' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(repository.find(KEY)).resolves.toBeNull();
  });
});
