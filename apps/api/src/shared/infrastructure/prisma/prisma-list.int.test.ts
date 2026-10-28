import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../domain/list-query';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated-client';
import { listPage, type SortMap } from './prisma-list';
import { PrismaService } from './prisma.service';
import { softDeleteExtension } from './soft-delete.extension';

const admin = createTestPrisma();
// Separate client with query events, to observe the bind parameters of each statement.
const spyBase = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
  log: [{ emit: 'event', level: 'query' }],
});
const statements: { query: string; params: string }[] = [];
spyBase.$on('query', (e) => statements.push({ query: e.query, params: e.params }));
const spyDb = spyBase.$extends(softDeleteExtension);
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const db = service.client;

const base = {
  kind: 'PERSONA',
  legalName: 'L',
  taxId: 'V-1',
  country: 'VE',
  address: 'a',
  phone: '1',
} as const;
const sortMap: SortMap = {
  tradeName: 'tradeName',
  activatedAt: { path: 'activatedAt', nullable: true },
};
const defaultSort = { field: 'tradeName', direction: 'asc' } as const;

const list = (
  query: Partial<ListQuery> = {},
  where: Record<string, unknown> = {},
  sqlWhere?: Prisma.Sql,
) =>
  listPage(db, {
    sqlWhere,
    table: 'Client',
    searchColumns: ['tradeName', 'legalName'],
    sortMap,
    defaultSort,
    where,
    query: { ...DEFAULT_LIST_QUERY, ...query },
    find: (args) => db.client.findMany(args),
    count: (args) => db.client.count(args),
  });
const names = (r: { items: { tradeName: string }[] }) => r.items.map((c) => c.tradeName);

async function seed(
  rows: { tradeName: string; legalName?: string; activatedAt?: Date | null; deletedAt?: Date }[],
) {
  let n = 0;
  for (const r of rows) {
    n++;
    await admin.client.create({
      data: {
        ...base,
        taxId: `V-${n}`,
        legalName: 'L',
        ...r,
        code: `CLI-${String(n).padStart(4, '0')}`,
      },
    });
  }
}

beforeEach(async () => {
  await truncateBusinessTables(admin);
});
afterAll(async () => {
  await spyBase.$disconnect();
  await db.$disconnect();
  await admin.$disconnect();
});

describe('listPage', () => {
  it('"Cotizacion" matches "Cotización" and is case-insensitive', async () => {
    await seed([{ tradeName: 'Cotización Uno' }, { tradeName: 'Otro' }]);
    expect(names(await list({ q: 'cotizacion' }))).toEqual(['Cotización Uno']);
    expect(names(await list({ q: 'COTIZACIÓN' }))).toEqual(['Cotización Uno']);
  });

  it('searches every given column', async () => {
    await seed([{ tradeName: 'A', legalName: 'Ñandú S.A.' }, { tradeName: 'B' }]);
    expect(names(await list({ q: 'nandu' }))).toEqual(['A']);
  });

  it('escapes LIKE metacharacters: a literal % or _ does not match everything', async () => {
    await seed([
      { tradeName: 'Half 50% off' },
      { tradeName: 'Plain' },
      { tradeName: 'snake_case' },
      { tradeName: 'snakeXcase' },
    ]);
    expect(names(await list({ q: '%' }))).toEqual(['Half 50% off']);
    expect(names(await list({ q: '_' }))).toEqual(['snake_case']);
    expect(names(await list({ q: '\\' }))).toEqual([]);
  });

  it('treats SQL injection text as data', async () => {
    await seed([{ tradeName: 'Plain' }]);
    const result = await list({ q: '\'; DROP TABLE "Client"; --' });
    expect(result.total).toBe(0);
    expect(await admin.client.count()).toBe(1);
  });

  it('sorts nullable columns with nulls last ascending and descending', async () => {
    await seed([
      { tradeName: 'N1', activatedAt: null },
      { tradeName: 'D1', activatedAt: new Date('2026-01-01') },
      { tradeName: 'D2', activatedAt: new Date('2026-02-01') },
      { tradeName: 'N2', activatedAt: null },
    ]);
    const asc = await list({ sort: { field: 'activatedAt', direction: 'asc' } });
    expect(names(asc)).toEqual(['D1', 'D2', 'N1', 'N2']);
    const desc = await list({ sort: { field: 'activatedAt', direction: 'desc' } });
    expect(names(desc)).toEqual(['D2', 'D1', 'N1', 'N2']);
  });

  it('applies the default sort, a requested direction and the archived modes', async () => {
    await seed([{ tradeName: 'b' }, { tradeName: 'a' }, { tradeName: 'z', deletedAt: new Date() }]);
    expect(names(await list())).toEqual(['a', 'b']);
    expect(names(await list({ sort: { field: 'tradeName', direction: 'desc' } }))).toEqual([
      'b',
      'a',
    ]);
    expect(names(await list({ archived: 'only' }))).toEqual(['z']);
    expect(names(await list({ archived: 'include' }))).toEqual(['a', 'b', 'z']);
  });

  it('windows the page and reports a total consistent with the filters', async () => {
    await seed(
      Array.from({ length: 30 }, (_, i) => ({ tradeName: `Item ${String(i).padStart(2, '0')}` })),
    );
    const first = await list();
    expect(first.items).toHaveLength(25);
    expect(first).toMatchObject({ total: 30, page: 1, pageSize: 25, pageCount: 2 });
    const second = await list({ page: 2 });
    expect(names(second)).toEqual(['Item 25', 'Item 26', 'Item 27', 'Item 28', 'Item 29']);
    const filtered = await list({ q: 'item 1' });
    expect(filtered.total).toBe(10);
    const withWhere = await list({}, { kind: 'EMPRESA' });
    expect(withWhere).toMatchObject({ total: 0, pageCount: 1 });
  });

  it('tie-breaks equal sort values by id so pages never overlap', async () => {
    await seed(Array.from({ length: 6 }, () => ({ tradeName: 'Same' })));
    const p1 = await list({ pageSize: 25 });
    const ids = p1.items.map((c) => (c as unknown as { id: string }).id);
    expect(new Set(ids).size).toBe(6);
  });

  it('combines search, archived=only and a resource filter', async () => {
    await seed([
      { tradeName: 'Alfa live' },
      { tradeName: 'Alfa gone', deletedAt: new Date() },
      { tradeName: 'Alfa other', deletedAt: new Date() },
      { tradeName: 'Beta gone', deletedAt: new Date() },
    ]);
    await admin.client.update({ where: { code: 'CLI-0003' }, data: { kind: 'EMPRESA' } });
    const result = await list(
      { q: 'alfa', archived: 'only' },
      { kind: 'PERSONA' },
      Prisma.sql`"kind" = ${'PERSONA'}::"ClientKind"`,
    );
    expect(names(result)).toEqual(['Alfa gone']);
    expect(result.total).toBe(1);
  });

  it('keeps NULLS LAST in both directions when searching', async () => {
    await seed([
      { tradeName: 'Q N1', activatedAt: null },
      { tradeName: 'Q D1', activatedAt: new Date('2026-01-01') },
      { tradeName: 'Q D2', activatedAt: new Date('2026-02-01') },
      { tradeName: 'Q N2', activatedAt: null },
      { tradeName: 'Skip', activatedAt: new Date('2026-03-01') },
    ]);
    const asc = await list({ q: 'q ', sort: { field: 'activatedAt', direction: 'asc' } });
    expect(names(asc)).toEqual(['Q D1', 'Q D2', 'Q N1', 'Q N2']);
    const desc = await list({ q: 'q ', sort: { field: 'activatedAt', direction: 'desc' } });
    expect(names(desc)).toEqual(['Q D2', 'Q D1', 'Q N1', 'Q N2']);
    expect(desc.total).toBe(4);
  });

  it('pages a 70 000-row match in SQL without bind parameters proportional to the match set', async () => {
    await admin.$executeRawUnsafe(`
      INSERT INTO "Client" ("id","code","kind","tradeName","legalName","taxId","country","address","phone","updatedAt")
      SELECT 'bulk' || i, 'BULK-' || i, 'PERSONA'::"ClientKind", 'Bulk ' || lpad(i::text, 6, '0'),
             'L', 'V-' || i, 'VE', 'a', '1', now()
      FROM generate_series(1, 70000) AS i`);
    statements.length = 0;
    const result = await listPage(spyDb, {
      table: 'Client',
      searchColumns: ['tradeName', 'legalName'],
      sortMap,
      defaultSort,
      query: { ...DEFAULT_LIST_QUERY, q: 'BULK', page: 3, pageSize: 25 },
      find: (args) => spyDb.client.findMany(args),
      count: (args) => spyDb.client.count(args),
    });
    expect(result.total).toBe(70000);
    expect(result.items).toHaveLength(25);
    expect(result.items[0]?.tradeName).toBe('Bulk 000051');
    expect(result.items[24]?.tradeName).toBe('Bulk 000075');
    expect(result.items.map((c) => c.tradeName)).toEqual(
      [...result.items.map((c) => c.tradeName)].sort(),
    );
    const bindCounts = statements.map((s) => (JSON.parse(s.params) as unknown[]).length);
    expect(bindCounts.length).toBeGreaterThan(0);
    const max = Math.max(...bindCounts);
    expect(max).toBeLessThanOrEqual(25 + 8);
  }, 60_000);
});
