import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { assertLocalDatabaseUrl } from './local-db-guard';

/** Tables holding seeded catalogs and settings: kept by `truncateBusinessTables()`. */
export const CATALOG_TABLES = [
  'Currency',
  'PaymentMethod',
  'DocumentCategory',
  'DocumentType',
  'ExpenseCategory',
  'Technology',
  'Setting',
  'Sequence',
] as const;

/** Test Prisma client over the pg adapter. Refuses a non-local `DATABASE_URL`. */
export function createTestPrisma(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  const connectionString = assertLocalDatabaseUrl(url);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Empties every business table (everything but the seeded catalogs and Prisma's history) and resets the
 * sequences to 0, leaving the database as the seed left it.
 */
export async function truncateBusinessTables(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const keep = new Set<string>(CATALOG_TABLES);
  const tables = rows.map((r) => r.tablename).filter((t) => !keep.has(t));
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.replaceAll('"', '""')}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  await prisma.sequence.updateMany({ data: { value: 0 } });
}
