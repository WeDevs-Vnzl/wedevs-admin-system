import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildProviderPaymentWorld } from '../provider-payment-int-world';
import { command } from '../provider-payment-world';
import { Gate, catalogIds, gated, interleave, seedAccount, seedClient } from './world';

/**
 * Concurrent deliveries of provider events over real PostgreSQL (C18, DT-126, DT-192). The first delivery is
 * paused once it wrote its source rows; the second one then runs. With the event row as the first write, the
 * second blocks on its unique and, once the first commits, answers `DUPLICATE`; without it (RED) both write.
 * `PROVIDER_PAYMENT_CONCURRENCY_RED=1` blinds the event store to duplicates: these tests must then fail.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let methodId: string;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const setup = buildProviderPaymentWorld(service);
  await setup.uow.run(async () => {
    await seedClient(setup.host.db, 'cli_a');
    await seedAccount(setup.host.db, 'acc_a');
    methodId = (await catalogIds(setup.host.db)).methodId;
  });
}, 60_000);

const delivery = (over = {}) =>
  command({
    clientId: 'cli_a',
    accountId: 'acc_a',
    methodId,
    receivedAt: new Date('2026-10-09T15:00:00.000Z'),
    ...over,
  });

function twoWorlds() {
  const gate = new Gate();
  const slow = buildProviderPaymentWorld(service, {
    writer: (writer) => gated(writer, gate, ['replaceFacts'], 'before'),
  });
  const fast = buildProviderPaymentWorld(service);
  return { gate, slow, fast };
}

const payments = () => admin.payment.findMany({ where: { externalProvider: 'STRIPE' } });
const events = () => admin.integrationEvent.findMany();

describe('two deliveries of one event at once', () => {
  it('writes one payment and one PROCESSED row; the other delivery is a duplicate', async () => {
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.record.execute(SYSTEM_ACTOR, delivery()),
      () => fast.record.execute(SYSTEM_ACTOR, delivery()),
    );

    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { outcome: 'RECORDED' } });
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { outcome: 'DUPLICATE' } });
    expect(await payments()).toHaveLength(1);
    expect(await events()).toEqual([
      expect.objectContaining({ eventId: 'evt_1', outcome: 'PROCESSED', entityType: 'PAYMENT' }),
    ]);
  });

  it('six free-running deliveries: exactly one payment, the rest duplicates', async () => {
    const worlds = [0, 1, 2, 3, 4, 5].map(() => buildProviderPaymentWorld(service));

    const results = await Promise.allSettled(
      worlds.map((world) => world.record.execute(SYSTEM_ACTOR, delivery())),
    );

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value.outcome : 'ERROR'));
    expect(outcomes.filter((o) => o === 'RECORDED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'DUPLICATE')).toHaveLength(5);
    expect(await payments()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
  });
});

describe('two events for one provider payment at once', () => {
  it('writes one payment: the other event finds it (EXISTING) and is stored PROCESSED', async () => {
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.record.execute(SYSTEM_ACTOR, delivery()),
      () => fast.record.execute(SYSTEM_ACTOR, delivery({ eventId: 'evt_2' })),
    );

    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { outcome: 'RECORDED' } });
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { outcome: 'EXISTING' } });
    expect(await payments()).toHaveLength(1);
  });
});
