import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';

// Each seed run spawns tsx; allow for slow starts.
const SPAWN_TIMEOUT = 60_000;
const ROOT = resolve(__dirname, '../..');
const TSX = resolve(ROOT, 'node_modules/.bin/tsx');

function runSeed(databaseUrl: string, args: string[] = []) {
  return spawnSync(TSX, ['prisma/seed.ts', ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

async function counts(prisma: PrismaClient) {
  return {
    currency: await prisma.currency.count(),
    paymentMethod: await prisma.paymentMethod.count(),
    documentCategory: await prisma.documentCategory.count(),
    documentType: await prisma.documentType.count(),
    expenseCategory: await prisma.expenseCategory.count(),
    technology: await prisma.technology.count(),
    setting: await prisma.setting.count(),
    sequence: await prisma.sequence.count(),
  };
}

let prisma: PrismaClient;
const url = assertLocalDatabaseUrl(process.env.DATABASE_URL);

beforeAll(() => {
  prisma = createTestPrisma(url);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seed', () => {
  it(
    'is idempotent: running twice leaves identical row counts',
    async () => {
      const first = runSeed(url);
      expect(first.status, first.stderr).toBe(0);
      const after1 = await counts(prisma);
      const second = runSeed(url);
      expect(second.status, second.stderr).toBe(0);
      expect(await counts(prisma)).toEqual(after1);
      expect(after1.currency).toBe(5);
      expect(after1.paymentMethod).toBe(10);
      expect(after1.documentCategory).toBe(5);
      expect(after1.documentType).toBe(17);
      expect(after1.technology).toBeGreaterThanOrEqual(55);
      expect(after1.technology).toBeLessThanOrEqual(65);
    },
    SPAWN_TIMEOUT,
  );

  it('seeds the currencies, fiscal setting and six sequences at 0', async () => {
    const codes = (await prisma.currency.findMany({ orderBy: { code: 'asc' } })).map((c) => c.code);
    expect(codes).toEqual(['COP', 'EUR', 'USD', 'USDT', 'VES']);

    const fiscal = await prisma.setting.findUniqueOrThrow({ where: { key: 'fiscal' } });
    expect(fiscal.value).toMatchObject({
      ivaRates: ['16', '8', '0'],
      ivaDefaultRate: '16',
      igtfRate: '3',
      invoiceDefaultDueDays: 15,
    });

    const sequences = await prisma.sequence.findMany({ orderBy: { name: 'asc' } });
    expect(sequences.map((s) => [s.name, s.value])).toEqual([
      ['CLI', 0],
      ['DOC', 0],
      ['FAC', 0],
      ['GAS', 0],
      ['PAG', 0],
      ['PRY', 0],
    ]);
  });

  it('seeds technologies with nameEn and a two-level expense category tree', async () => {
    expect(await prisma.technology.count({ where: { nameEn: null } })).toBe(0);
    const roots = await prisma.expenseCategory.count({ where: { parentId: null } });
    expect(roots).toBe(10);
  });

  it(
    'a re-run does not reset a sequence that has advanced',
    async () => {
      await prisma.sequence.update({ where: { name: 'CLI' }, data: { value: 7 } });
      expect(runSeed(url).status).toBe(0);
      expect((await prisma.sequence.findUniqueOrThrow({ where: { name: 'CLI' } })).value).toBe(7);
      await truncateBusinessTables(prisma); // resets sequences, keeps catalogs
      expect((await prisma.sequence.findUniqueOrThrow({ where: { name: 'CLI' } })).value).toBe(0);
      expect(await prisma.currency.count()).toBe(5);
    },
    SPAWN_TIMEOUT,
  );

  it(
    'refuses a non-localhost DATABASE_URL without --allow-remote',
    async () => {
      const result = runSeed('postgresql://u:p@db.example.invalid:5432/core');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/--allow-remote/);
      expect(result.stderr).not.toMatch(/example\.invalid/);
    },
    SPAWN_TIMEOUT,
  );
});

describe('seed (user edits and remote forms)', () => {
  it(
    'create-only: edits to seeded catalogs and settings survive a re-run',
    async () => {
      await prisma.currency.update({ where: { code: 'USD' }, data: { name: 'Edited dollar' } });
      await prisma.setting.update({
        where: { key: 'fiscal' },
        data: { value: { ivaRates: ['16'], ivaDefaultRate: '16', igtfRate: '5' } },
      });
      await prisma.technology.update({ where: { slug: 'react' }, data: { active: false } });
      const result = runSeed(url);
      expect(result.status, result.stderr).toBe(0);
      expect((await prisma.currency.findUniqueOrThrow({ where: { code: 'USD' } })).name).toBe(
        'Edited dollar',
      );
      expect(
        (await prisma.setting.findUniqueOrThrow({ where: { key: 'fiscal' } })).value,
      ).toMatchObject({
        igtfRate: '5',
      });
      expect((await prisma.technology.findUniqueOrThrow({ where: { slug: 'react' } })).active).toBe(
        false,
      );
      // restore the seeded values for the other tests
      await prisma.currency.update({
        where: { code: 'USD' },
        data: { name: 'Dólar estadounidense' },
      });
      await prisma.technology.update({ where: { slug: 'react' }, data: { active: true } });
      await prisma.setting.delete({ where: { key: 'fiscal' } });
      expect(runSeed(url).status).toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    'refuses a local authority with a ?host= / ?hostaddr= override',
    () => {
      for (const q of ['host=db.example.invalid', 'hostaddr=10.255.255.1']) {
        const result = runSeed(`postgresql://postgres:dev@localhost:5433/core?${q}`);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/--allow-remote/);
      }
    },
    SPAWN_TIMEOUT,
  );

  it(
    'prints only an error code or name when the seed fails',
    () => {
      const result = runSeed('postgresql://postgres:wrongpass@localhost:1/core');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/^Seed failed: \S+\s*$/);
      expect(result.stderr).not.toMatch(/wrongpass/);
    },
    SPAWN_TIMEOUT,
  );
});

describe('local-db-guard', () => {
  it('accepts localhost, 127.0.0.1 and ::1', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() => assertLocalDatabaseUrl(`postgresql://u:p@${host}:5432/core`)).not.toThrow();
    }
  });

  it('rejects remote hosts, malformed and missing URLs', () => {
    expect(() => assertLocalDatabaseUrl('postgresql://u:p@db.example.com:5432/core')).toThrow();
    expect(() => assertLocalDatabaseUrl('not a url')).toThrow();
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow();
  });
});
