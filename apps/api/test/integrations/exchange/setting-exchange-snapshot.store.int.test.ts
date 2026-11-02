import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EXCHANGE_SNAPSHOT_SETTING_KEY,
  SettingExchangeSnapshotStore,
  parseSnapshot,
} from '../../../src/modules/integrations/exchange.module';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma } from '../../support/db';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const store = new SettingExchangeSnapshotStore(host);

const snapshot = {
  syncedAt: new Date('2026-11-02T12:00:00.000Z'),
  balances: [{ asset: 'USDT', free: '120.50000000', locked: '0.00000000' }],
};

beforeEach(() => admin.setting.deleteMany({ where: { key: EXCHANGE_SNAPSHOT_SETTING_KEY } }));
afterAll(async () => {
  await admin.setting.deleteMany({ where: { key: EXCHANGE_SNAPSHOT_SETTING_KEY } });
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('SettingExchangeSnapshotStore', () => {
  it('answers null before the first run', async () => {
    expect(await store.load()).toBeNull();
  });

  it('round-trips the snapshot with the exchange amount strings untouched, replacing the previous one', async () => {
    await store.save({ syncedAt: new Date('2026-11-01T00:00:00Z'), balances: [] });
    await store.save(snapshot);
    expect(await store.load()).toEqual(snapshot);
    expect(await admin.setting.count({ where: { key: EXCHANGE_SNAPSHOT_SETTING_KEY } })).toBe(1);
  });

  it('writes inside the unit of work and rolls back with it', async () => {
    await expect(
      uow.run(async () => {
        await store.save(snapshot);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await store.load()).toBeNull();
  });

  it('reads a malformed stored value as no snapshot', async () => {
    for (const value of [
      'text',
      { syncedAt: 'nope', balances: [] },
      { syncedAt: '2026-11-02T12:00:00.000Z', balances: [{ asset: 'X', free: 1, locked: '0' }] },
      { syncedAt: '2026-11-02T12:00:00.000Z' },
    ]) {
      expect(parseSnapshot(value)).toBeNull();
    }
  });
});
