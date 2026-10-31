import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ExchangeRateDraft } from '../application/ports/exchange-rate.repository.port';
import { PrismaExchangeRateRepository } from './prisma-exchange-rate.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaExchangeRateRepository(host);

let counter = 0;
const draft = (over: Partial<ExchangeRateDraft> = {}): ExchangeRateDraft => ({
  id: `rt_int_${++counter}`,
  date: '2026-10-12',
  currency: 'VES',
  usdRate: '755.16',
  source: 'MANUAL',
  createdAt: '2026-10-12T15:00:00.000Z',
  createdById: null,
  ...over,
});

beforeEach(async () => {
  await admin.exchangeRate.deleteMany();
});
afterAll(async () => {
  await admin.exchangeRate.deleteMany();
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaExchangeRateRepository (int)', () => {
  it('creates a row and reads the date, rate and timestamp back as strings', async () => {
    const saved = await repository.save(draft({ usdRate: '755.1' }), 'overwrite');
    expect(saved).toMatchObject({
      outcome: 'created',
      rate: {
        date: '2026-10-12',
        currency: 'VES',
        usdRate: '755.1',
        source: 'MANUAL',
        createdAt: '2026-10-12T15:00:00.000Z',
        createdById: null,
      },
    });
  });

  it('keeps 8 decimals exactly and never an exponent', async () => {
    const saved = await repository.save(draft({ usdRate: '0.00000001' }), 'overwrite');
    expect(saved.rate?.usdRate).toBe('0.00000001');
    const big = await repository.save(
      draft({ currency: 'COP', usdRate: '999999999999.12345678' }),
      'overwrite',
    );
    expect(big.rate?.usdRate).toBe('999999999999.12345678');
  });

  it('updates only the rate of an existing key, keeping its id, createdAt and creator', async () => {
    const first = await repository.save(draft({ id: 'rt_first', createdById: null }), 'overwrite');
    const again = await repository.save(
      draft({ id: 'rt_second', usdRate: '760', createdAt: '2026-10-13T00:00:00.000Z' }),
      'overwrite',
    );
    expect(again).toMatchObject({
      outcome: 'updated',
      rate: { id: 'rt_first', usdRate: '760', createdAt: first.rate?.createdAt },
    });
    expect(await admin.exchangeRate.count()).toBe(1);
  });

  it('skips an existing key and leaves its rate, and still creates a new one', async () => {
    await repository.save(draft({ usdRate: '700' }), 'overwrite');
    expect(await repository.save(draft({ usdRate: '999' }), 'skip')).toEqual({
      outcome: 'skipped',
      rate: null,
    });
    expect((await admin.exchangeRate.findFirstOrThrow()).usdRate.toFixed()).toBe('700');
    expect((await repository.save(draft({ source: 'BCV' }), 'skip')).outcome).toBe('created');
  });

  it('rolls a write back with its unit of work', async () => {
    await expect(
      uow.run(async () => {
        await repository.save(draft(), 'overwrite');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await admin.exchangeRate.count()).toBe(0);
  });

  it('answers the rows of the latest date on or before the requested one', async () => {
    await repository.save(draft({ date: '2026-10-01', usdRate: '700' }), 'overwrite');
    await repository.save(draft({ date: '2026-10-09', usdRate: '755' }), 'overwrite');
    await repository.save(
      draft({ date: '2026-10-09', usdRate: '760', source: 'BCV' }),
      'overwrite',
    );
    await repository.save(draft({ date: '2026-10-20', usdRate: '800' }), 'overwrite');
    await repository.save(
      draft({ date: '2026-10-09', currency: 'EUR', usdRate: '0.9' }),
      'overwrite',
    );

    const rows = await repository.findEffective('VES', '2026-10-12');
    expect(rows.map((row) => [row.date, row.source, row.usdRate]).sort()).toEqual([
      ['2026-10-09', 'BCV', '760'],
      ['2026-10-09', 'MANUAL', '755'],
    ]);
    expect(await repository.findEffective('VES', '2026-09-30')).toEqual([]);
    expect(await repository.findEffective('VES', '2026-10-20')).toHaveLength(1);
  });

  it('filters, sorts and pages the list, newest date first, ties by id', async () => {
    await repository.save(
      draft({ id: 'a', date: '2026-10-01', usdRate: '700', source: 'BCV' }),
      'overwrite',
    );
    await repository.save(draft({ id: 'b', date: '2026-10-09', usdRate: '755' }), 'overwrite');
    await repository.save(
      draft({ id: 'c', date: '2026-10-09', currency: 'EUR', usdRate: '0.9' }),
      'overwrite',
    );
    const base = { page: 1, pageSize: 2, sort: { field: 'date', direction: 'desc' as const } };

    const first = await repository.list(base);
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2, pageCount: 2 });
    expect(first.items.map((row) => row.id)).toEqual(['b', 'c']);
    expect((await repository.list({ ...base, page: 2 })).items.map((row) => row.id)).toEqual(['a']);

    const byRate = await repository.list({
      ...base,
      pageSize: 25,
      sort: { field: 'usdRate', direction: 'asc' },
    });
    expect(byRate.items.map((row) => row.usdRate)).toEqual(['0.9', '700', '755']);
    expect(
      (await repository.list({ ...base, pageSize: 25, currency: ['VES'], source: ['BCV'] })).total,
    ).toBe(1);
    expect(
      (
        await repository.list({
          ...base,
          pageSize: 25,
          dateFrom: '2026-10-02',
          dateTo: '2026-10-09',
        })
      ).total,
    ).toBe(2);
  });

  it('reports which currency codes exist in the catalog', async () => {
    const known = await repository.knownCurrencies(['VES', 'EUR', 'ZZZ']);
    expect([...known].sort()).toEqual(['EUR', 'VES']);
    expect((await repository.knownCurrencies([])).size).toBe(0);
  });
});
