import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { ConflictError } from '../../../shared/domain/domain-error';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { Currency } from '../domain/currency';
import { PrismaCurrencyRepository } from './prisma-currency.repository';

/** Test rows only: the seeded catalog (USD, VES, EUR, USDT, COP) is never touched. */
const TEST_CODES = ['ZTI', 'ZTJ'];
const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaCurrencyRepository(host);

const row = (code: string, overrides: Partial<Currency> = {}): Currency => ({
  code,
  name: `Moneda ${code}`,
  symbol: code,
  decimals: 2,
  active: true,
  ...overrides,
});

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(async () => {
  await admin.currency.deleteMany({ where: { code: { in: TEST_CODES } } });
});
afterAll(async () => {
  await admin.currency.deleteMany({ where: { code: { in: TEST_CODES } } });
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaCurrencyRepository (int)', () => {
  it('lists the seeded catalog, USD included', async () => {
    const codes = (await repository.list()).map((c) => c.code);
    expect(codes).toContain('USD');
  });

  it('finds a currency by code and answers null for an unknown code', async () => {
    await expect(repository.findByCode('USD')).resolves.toMatchObject({
      code: 'USD',
      active: true,
    });
    await expect(repository.findByCode('ZZZ')).resolves.toBeNull();
  });

  it('inserts a row and reads it back with its decimals as a number', async () => {
    await uow.run(() => repository.insert(row('ZTI', { decimals: 0, active: false })));
    await expect(repository.findByCode('ZTI')).resolves.toEqual(
      row('ZTI', { decimals: 0, active: false }),
    );
  });

  it('refuses a code that is already stored with CONFLICT on the code', async () => {
    const attempt = repository.insert(row('USD'));
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({
      fieldErrors: { code: ['catalogs.currencies.errors.codeTaken'] },
    });
  });

  it('updates the editable fields and keeps the code', async () => {
    await uow.run(() => repository.insert(row('ZTI')));
    await uow.run(() =>
      repository.update(
        row('ZTI', { name: 'Renombrada', symbol: 'Z', decimals: 4, active: false }),
      ),
    );
    await expect(repository.findByCode('ZTI')).resolves.toEqual(
      row('ZTI', { name: 'Renombrada', symbol: 'Z', decimals: 4, active: false }),
    );
  });

  it('discards the insert when the unit of work rolls back', async () => {
    await expect(
      uow.run(async () => {
        await repository.insert(row('ZTI'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(repository.findByCode('ZTI')).resolves.toBeNull();
  });
});
