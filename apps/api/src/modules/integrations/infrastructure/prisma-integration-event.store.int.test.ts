import { afterAll, describe, expect, it } from 'vitest';
import { integrationEventStoreContract } from '../../../../test/integrations/contracts/integration-event-store.contract';
import { createTestPrisma } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaIntegrationEventStore } from './prisma-integration-event.store';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const store = new PrismaIntegrationEventStore(host);

afterAll(async () => {
  await admin.integrationEvent.deleteMany();
  await service.client.$disconnect();
  await admin.$disconnect();
});

integrationEventStoreContract('Prisma', async () => {
  await admin.integrationEvent.deleteMany();
  return { store };
});

describe('PrismaIntegrationEventStore', () => {
  const entry = {
    provider: 'STRIPE',
    eventId: 'evt_tx',
    type: 'payment_intent.succeeded',
    outcome: 'PROCESSED',
    reasonCode: null,
    entityType: null,
    entityId: null,
    receivedAt: new Date('2026-11-02T10:00:00.000Z'),
    processedAt: null,
  } as const;

  it('does not poison the surrounding transaction when the event already exists', async () => {
    await admin.integrationEvent.deleteMany();
    await store.record(entry);
    const result = await uow.run(async () => {
      const duplicate = await store.record(entry);
      const other = await store.record({ ...entry, eventId: 'evt_tx_2' });
      return [duplicate, other];
    });
    expect(result).toEqual(['DUPLICATE', 'RECORDED']);
    expect(await admin.integrationEvent.count()).toBe(2);
  });

  it('lets exactly one of two concurrent deliveries record the event', async () => {
    await admin.integrationEvent.deleteMany();
    const results = await Promise.all([
      store.record({ ...entry, eventId: 'evt_race' }),
      store.record({ ...entry, eventId: 'evt_race' }),
    ]);
    expect([...results].sort()).toEqual(['DUPLICATE', 'RECORDED']);
    expect(await admin.integrationEvent.count()).toBe(1);
  });

  it('rolls the event back with its unit of work', async () => {
    await admin.integrationEvent.deleteMany();
    await expect(
      uow.run(async () => {
        await store.record({ ...entry, eventId: 'evt_rb' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.find('STRIPE', 'evt_rb')).toBeNull();
  });
});
