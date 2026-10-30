import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createTestPrisma } from './support/db';
import { asAdmin, TEMPLATE_DATABASE, withDatabase } from './support/test-database';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('test database per spec file (DT-117)', () => {
  it('points DATABASE_URL at a clone of its own, never at the template', async () => {
    const [row] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(row?.name).toMatch(/^spec_[0-9a-f]{32}$/);
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toBe(`/${row?.name}`);
    expect(process.env.DIRECT_URL).toBe(process.env.DATABASE_URL);
  });

  it('starts from the migrated and seeded template', async () => {
    expect(await prisma.currency.count()).toBe(5);
    const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm')`;
    expect(Number(row?.count)).toBe(2);
  });

  it('keeps its writes out of the template', async () => {
    await prisma.$executeRawUnsafe('CREATE TABLE isolation_probe (id int)');
    const serverUrl = inject('postgresUrl');
    // Holds the clone lock: a session on the template makes a concurrent spec's clone fail.
    await asAdmin(serverUrl, async (admin) => {
      await admin.query('SELECT pg_advisory_lock(hashtext($1))', [TEMPLATE_DATABASE]);
      const template = new pg.Client({
        connectionString: withDatabase(serverUrl, TEMPLATE_DATABASE),
      });
      await template.connect();
      try {
        const { rows } = await template.query(
          "SELECT to_regclass('public.isolation_probe') AS probe",
        );
        expect(rows[0].probe).toBeNull();
      } finally {
        await template.end();
      }
    });
  });
});
