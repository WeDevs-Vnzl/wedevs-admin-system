import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paymentLinkRepositoryContract } from '../../../../test/integrations/contracts/payment-link.repository.contract';
import { seedClient, seedInvoice } from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { PaymentLinkRepository } from '../application/ports/payment-link.repository.port';
import type { PaymentLink } from '../domain/payment-link';
import { PrismaPaymentLinkRepository } from './prisma-payment-link.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaPaymentLinkRepository(host);

/** The column is a `uuid`; the shared contract uses readable request ids, so the harness maps them both ways. */
const uuidOf = (text: string): string => {
  const h = createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function withReadableRequestIds(inner: PaymentLinkRepository): PaymentLinkRepository {
  const names = new Map<string, string>();
  const toDb = (link: PaymentLink): PaymentLink => {
    const requestId = uuidOf(link.requestId);
    names.set(requestId, link.requestId);
    return { ...link, requestId };
  };
  const fromDb = (link: PaymentLink | null): PaymentLink | null =>
    link ? { ...link, requestId: names.get(link.requestId) ?? link.requestId } : null;
  return {
    save: (link) => inner.save(toDb(link)),
    findById: async (id) => fromDb(await inner.findById(id)),
    findByRequestId: async (invoiceId, requestId) =>
      fromDb(await inner.findByRequestId(invoiceId, uuidOf(requestId))),
    findByExternalId: async (externalId) => fromDb(await inner.findByExternalId(externalId)),
    listByInvoice: async (invoiceId) =>
      (await inner.listByInvoice(invoiceId)).map((link) => fromDb(link) as PaymentLink),
    listInvoiceIdsWithOpenLinks: () => inner.listInvoiceIdsWithOpenLinks(),
    listPendingProviderDeactivation: async () =>
      (await inner.listPendingProviderDeactivation()).map((link) => fromDb(link) as PaymentLink),
    markProviderDeactivated: (linkId, at) => inner.markProviderDeactivated(linkId, at),
  };
}

async function reset(): Promise<void> {
  await truncateBusinessTables(admin);
  await uow.run(async () => {
    await seedClient(host.db, 'cli_a');
    for (const id of ['inv-1', 'inv-2']) {
      await seedInvoice(host.db, {
        id,
        clientId: 'cli_a',
        lines: [{ id: `${id}_l`, projectId: null, unitPrice: '100.00', ivaRate: null }],
      });
    }
  });
}

beforeAll(reset, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

paymentLinkRepositoryContract('Prisma', async () => {
  await reset();
  return { repository: withReadableRequestIds(repository) };
});

describe('PrismaPaymentLinkRepository', () => {
  const link: PaymentLink = {
    id: 'lnk_x',
    invoiceId: 'inv-1',
    requestId: uuidOf('x'),
    provider: 'STRIPE',
    externalId: null,
    url: null,
    amount: '1234567.50',
    currency: 'USD',
    status: 'PENDING',
    paymentId: null,
    deactivationReason: null,
    createdAt: new Date('2026-11-02T10:00:00.000Z'),
    createdById: 'usr_1',
    deactivatedAt: null,
    settledAt: null,
  };

  it('keeps money as a decimal string without rounding through a number', async () => {
    await reset();
    await repository.save(link);
    expect(await repository.findById('lnk_x')).toEqual(link);
  });

  it('refuses a second link with the same request id on one invoice', async () => {
    await reset();
    await repository.save(link);
    await expect(repository.save({ ...link, id: 'lnk_y' })).rejects.toThrow();
  });

  it('reads inside the ambient transaction and rolls back with it', async () => {
    await reset();
    await expect(
      uow.run(async () => {
        await repository.save(link);
        expect(await repository.findById('lnk_x')).not.toBeNull();
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await repository.findById('lnk_x')).toBeNull();
  });
});
