import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorld,
  catalogIds,
  seedAccount,
  seedClient,
  seedPayment,
  seedSearchEntry,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaSearchIndex } from '../../../shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { paymentSearchBody } from '../application/use-cases/payments/payment-support';
import { FinancePaymentMethodSearchDependents } from './payment-method-search-dependents.adapter';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const world = buildWorld(service);
const adapter = new FinancePaymentMethodSearchDependents(
  world.host,
  new PrismaSearchIndex(world.host),
);

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const bodyOf = async (entityId: string) =>
  (
    await admin.searchEntry.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: 'PAYMENT', entityId } },
    })
  ).body;

describe('paymentSearchBody', () => {
  it('joins the reference and the method name, and is null when both are missing', () => {
    expect(paymentSearchBody('REF-1', 'Zelle')).toBe('REF-1 Zelle');
    expect(paymentSearchBody(null, 'Zelle')).toBe('Zelle');
    expect(paymentSearchBody('REF-1', null)).toBe('REF-1');
    expect(paymentSearchBody(null, null)).toBeNull();
  });
});

describe('FinancePaymentMethodSearchDependents (int)', () => {
  it('rebuilds the body of every payment of the method, archived ones included, and leaves the rest', async () => {
    let otherMethodId = '';
    await world.uow.run(async () => {
      const db = world.host.db;
      await seedClient(db, 'cli_a');
      await seedAccount(db, 'acc_a');
      const { methodId } = await catalogIds(db);
      otherMethodId = (
        await db.paymentMethod.findFirstOrThrow({ where: { id: { not: methodId } } })
      ).id;
      for (const [id, archived, method] of [
        ['pay_live', false, methodId],
        ['pay_archived', true, methodId],
        ['pay_other', false, otherMethodId],
      ] as const) {
        await seedPayment(db, {
          id,
          clientId: 'cli_a',
          accountId: 'acc_a',
          methodId: method,
          amount: '10.00',
          archived,
        });
        await db.payment.update({
          where: { id },
          data: { reference: id === 'pay_live' ? 'REF-1' : null },
        });
        await seedSearchEntry(db, {
          entityType: 'PAYMENT',
          entityId: id,
          title: id,
          body: 'viejo',
        });
      }
    });
    const methodId = (await admin.payment.findUniqueOrThrow({ where: { id: 'pay_live' } }))
      .methodId;

    const changed = await world.uow.run(() => adapter.relabelMethod(methodId, 'Zelle Pro'));

    expect(changed).toBe(2);
    expect(await bodyOf('pay_live')).toBe('REF-1 Zelle Pro');
    expect(await bodyOf('pay_archived')).toBe('Zelle Pro');
    expect(await bodyOf('pay_other')).toBe('viejo');
    expect(await world.uow.run(() => adapter.relabelMethod(methodId, 'Zelle Pro'))).toBe(0);
  });
});
