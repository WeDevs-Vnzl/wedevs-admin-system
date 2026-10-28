/**
 * Catalog and settings seed (PRD §10.4, data-rules §9). Idempotent create-only upserts on natural keys (a re-run never overwrites user edits); no business
 * data (C5). Host guard: refuses a non-local DATABASE_URL unless `--allow-remote` is passed. That flag is
 * for the user only (safeguards.md rule 8); agents never pass it.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { CURRENCIES } from './seed-data/currencies';
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES } from './seed-data/document-types';
import { EXPENSE_CATEGORIES } from './seed-data/expense-categories';
import { PAYMENT_METHODS } from './seed-data/payment-methods';
import { SEQUENCES, SETTINGS } from './seed-data/settings';
import { TECHNOLOGIES } from './seed-data/technologies';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Query parameters with which `pg` overrides the URL authority host. */
const HOST_OVERRIDES = ['host', 'hostaddr', 'service'];

export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (HOST_OVERRIDES.some((key) => parsed.searchParams.has(key))) return false;
    return LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Guard refusal: its message is fixed text without connection details, so it is safe to print. */
export class SeedTargetError extends Error {
  override name = 'SeedTargetError';
}

/** Throws unless the URL is local or `--allow-remote` is in argv. Never prints the URL. */
export function assertSeedTarget(url: string | undefined, argv: readonly string[]): string {
  if (!url) throw new SeedTargetError('DATABASE_URL is not set');
  if (!isLocalDatabaseUrl(url) && !argv.includes('--allow-remote')) {
    throw new SeedTargetError(
      'Refusing to seed a non-local database without --allow-remote (user-only flag)',
    );
  }
  return url;
}

export async function seedCatalogs(prisma: PrismaClient): Promise<void> {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, create: c, update: {} });
  }
  for (const m of PAYMENT_METHODS) {
    await prisma.paymentMethod.upsert({ where: { code: m.code }, create: m, update: {} });
  }
  for (const c of DOCUMENT_CATEGORIES) {
    await prisma.documentCategory.upsert({ where: { id: c.id }, create: c, update: {} });
  }
  for (const t of DOCUMENT_TYPES) {
    await prisma.documentType.upsert({ where: { id: t.id }, create: t, update: {} });
  }
  for (const c of EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({ where: { id: c.id }, create: c, update: {} });
  }
  for (const t of TECHNOLOGIES) {
    await prisma.technology.upsert({ where: { slug: t.slug }, create: t, update: {} });
  }
  for (const s of SETTINGS) {
    const value = s.value as Prisma.InputJsonValue;
    await prisma.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value },
      update: {},
    });
  }
  // Sequences start at 0 and are never reset by a re-run (update is a no-op).
  for (const name of SEQUENCES) {
    await prisma.sequence.upsert({ where: { name }, create: { name, value: 0 }, update: {} });
  }
}

async function main(): Promise<void> {
  const url = assertSeedTarget(process.env.DATABASE_URL, process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedCatalogs(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    if (error instanceof SeedTargetError) {
      console.error(error.message);
      process.exit(1);
    }
    // Print only the error name/code, never the message (it may carry connection details).
    const code = (error as { code?: unknown } | null)?.code;
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Seed failed: ${typeof code === 'string' ? code : name}`);
    process.exit(1);
  });
}
