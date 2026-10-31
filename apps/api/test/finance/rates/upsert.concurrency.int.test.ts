import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LoadDailyRates } from '../../../src/modules/finance/application/use-cases/rates/load-daily-rates.use-case';
import { UpsertExchangeRate } from '../../../src/modules/finance/application/use-cases/rates/upsert-exchange-rate.use-case';
import { PrismaExchangeRateRepository } from '../../../src/modules/finance/infrastructure/prisma-exchange-rate.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { createTestPrisma } from '../../support/db';
import { userOf } from './world';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const rates = new PrismaExchangeRateRepository(host);
const authorization = new MatrixAuthorization();
const uow = new PrismaUnitOfWork(host);
const activity = new PrismaActivityLog(host, new PrismaClientMetricsWriter(host));
const clock = new SystemClock();
const ids = new CuidGenerator();
const currencies = { knownCodes: async (codes: readonly string[]) => new Set(codes) };
const upsert = new UpsertExchangeRate(authorization, uow, rates, activity, clock, ids, currencies);
const loadDaily = new LoadDailyRates(authorization, uow, rates, activity, clock, ids, currencies);

let caller = userOf('OWNER');

beforeEach(async () => {
  await admin.activityLog.deleteMany();
  await admin.exchangeRate.deleteMany();
  await admin.user.deleteMany();
  const row = await admin.user.create({
    data: {
      clerkId: 'user_rates_owner',
      email: 'rates@example.test',
      name: 'Owner',
      role: 'OWNER',
    },
  });
  caller = { ...userOf('OWNER'), userId: row.id };
});
afterAll(async () => {
  await admin.activityLog.deleteMany();
  await admin.exchangeRate.deleteMany();
  await admin.user.deleteMany();
  await service.client.$disconnect();
  await admin.$disconnect();
});

const input = (usdRate: string) => ({
  date: '2026-10-12',
  currency: 'VES',
  usdRate,
  source: 'MANUAL' as const,
});

describe('exchange rate writes under concurrency (int)', () => {
  it('stores one row when the same key is upserted by several callers at once, none fails', async () => {
    for (let round = 0; round < 3; round++) {
      await admin.exchangeRate.deleteMany();
      const results = await Promise.allSettled(
        ['755.1', '755.2', '755.3', '755.4'].map((rate) => upsert.execute(caller, input(rate))),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const rows = await admin.exchangeRate.findMany();
      expect(rows).toHaveLength(1);
      expect(['755.1', '755.2', '755.3', '755.4']).toContain(rows[0]?.usdRate.toFixed());
      const fulfilled = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      expect(fulfilled.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(fulfilled.map((r) => r.rate.id)).size).toBe(1);
    }
  });

  it('keeps one row per key when two daily loads overlap in different currency order', async () => {
    const rows = (order: string[]) =>
      order.map((currency) => ({ currency, usdRate: currency === 'VES' ? '755' : '0.86' }));
    const results = await Promise.allSettled([
      loadDaily.execute(caller, { date: '2026-10-12', source: 'BCV', rates: rows(['VES', 'EUR']) }),
      loadDaily.execute(caller, { date: '2026-10-12', source: 'BCV', rates: rows(['EUR', 'VES']) }),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await admin.exchangeRate.count()).toBe(2);
    const created = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.created] : []));
    expect(created.reduce((a, b) => a + b, 0)).toBe(2);
  });
});
