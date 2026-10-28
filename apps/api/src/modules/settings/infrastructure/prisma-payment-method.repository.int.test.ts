import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { ConflictError } from '../../../shared/domain/domain-error';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { PaymentMethod } from '../domain/payment-method';
import { PrismaPaymentMethodRepository } from './prisma-payment-method.repository';

/** Test rows only: the seeded methods are never touched. */
const TEST_CODES = ['TEST_INT_PM', 'TEST_INT_PM2'];
const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaPaymentMethodRepository(host);

const method = (
  id: string,
  code: string,
  overrides: Partial<PaymentMethod> = {},
): PaymentMethod => ({
  id,
  code,
  name: `Metodo ${code}`,
  nameEn: null,
  requiresReference: true,
  suggestsIgtf: false,
  active: true,
  ...overrides,
});

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(async () => {
  await admin.paymentMethod.deleteMany({ where: { code: { in: TEST_CODES } } });
});
afterAll(async () => {
  await admin.paymentMethod.deleteMany({ where: { code: { in: TEST_CODES } } });
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaPaymentMethodRepository (int)', () => {
  it('lists the seeded methods', async () => {
    expect((await repository.list()).length).toBeGreaterThan(0);
  });

  it('inserts a method, finds it by id and answers null for an unknown id', async () => {
    const created = method('pmt_int_a', 'TEST_INT_PM', { nameEn: 'Test', suggestsIgtf: true });
    await uow.run(() => repository.insert(created));
    await expect(repository.findById('pmt_int_a')).resolves.toEqual(created);
    await expect(repository.findById('pmt_int_missing')).resolves.toBeNull();
  });

  it('refuses a stored code with CONFLICT on the code', async () => {
    await uow.run(() => repository.insert(method('pmt_int_a', 'TEST_INT_PM')));
    const attempt = repository.insert(method('pmt_int_b', 'TEST_INT_PM'));
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({
      fieldErrors: { code: ['catalogs.paymentMethods.errors.codeTaken'] },
    });
  });

  it('updates the editable fields and keeps the code', async () => {
    await uow.run(() => repository.insert(method('pmt_int_a', 'TEST_INT_PM')));
    const updated = method('pmt_int_a', 'TEST_INT_PM', {
      name: 'Renombrado',
      active: false,
      requiresReference: false,
    });
    await uow.run(() => repository.update(updated));
    await expect(repository.findById('pmt_int_a')).resolves.toEqual(updated);
  });
});
