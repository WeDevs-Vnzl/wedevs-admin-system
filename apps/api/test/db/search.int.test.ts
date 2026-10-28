import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateBusinessTables } from '../support/db';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  await truncateBusinessTables(prisma);
});

afterAll(async () => {
  await truncateBusinessTables(prisma);
  await prisma.$disconnect();
});

describe('search (PRD §10.3)', () => {
  it('extensions unaccent and pg_trgm are present', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension`;
    const names = rows.map((r) => r.extname);
    expect(names).toEqual(expect.arrayContaining(['unaccent', 'pg_trgm']));
  });

  it('SearchEntry.search is a generated tsvector column', async () => {
    const rows = await prisma.$queryRaw<{ data_type: string; is_generated: string }[]>`
      SELECT data_type, is_generated FROM information_schema.columns
      WHERE table_name = 'SearchEntry' AND column_name = 'search'`;
    expect(rows).toEqual([{ data_type: 'tsvector', is_generated: 'ALWAYS' }]);
  });

  it('an es_unaccent query for "cotizacion" matches a SearchEntry titled "Cotización"', async () => {
    await prisma.searchEntry.create({
      data: { entityType: 'DOCUMENT', entityId: 'doc-1', code: 'DOC-0001', title: 'Cotización' },
    });
    await prisma.searchEntry.create({
      data: { entityType: 'DOCUMENT', entityId: 'doc-2', code: 'DOC-0002', title: 'Contrato' },
    });
    const rows = await prisma.$queryRaw<{ title: string }[]>`
      SELECT title FROM "SearchEntry" WHERE search @@ plainto_tsquery('es_unaccent', 'cotizacion')`;
    expect(rows.map((r) => r.title)).toEqual(['Cotización']);
    const accented = await prisma.$queryRaw<{ title: string }[]>`
      SELECT title FROM "SearchEntry" WHERE search @@ plainto_tsquery('es_unaccent', 'COTIZACIÓN')`;
    expect(accented.map((r) => r.title)).toEqual(['Cotización']);
  });

  it('search_entry_fts (GIN on search) and search_entry_trgm (GIN trigram on title) exist', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'SearchEntry'`;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get('search_entry_fts')).toMatch(/USING gin \(search\)/);
    expect(byName.get('search_entry_trgm')).toMatch(/USING gin \(title gin_trgm_ops\)/);
  });
});
