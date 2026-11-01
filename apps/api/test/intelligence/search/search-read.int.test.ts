import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  SearchCriteria,
  SearchReadPort,
} from '../../../src/modules/intelligence/application/ports/search-read.port';
import type { SearchableEntityType } from '../../../src/modules/intelligence/domain/search-query';
import { SEARCHABLE_ENTITY_TYPE_VALUES } from '../../../src/modules/intelligence/domain/search-query';
import { PrismaSearchRead } from '../../../src/modules/intelligence/infrastructure/prisma-search-read';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const reader: SearchReadPort = new PrismaSearchRead(new TransactionHost(service));

const ALL = SEARCHABLE_ENTITY_TYPE_VALUES;

type Seed = {
  type: SearchableEntityType;
  id: string;
  title: string;
  code?: string | null;
  subtitle?: string | null;
  body?: string | null;
  status?: string | null;
  archived?: boolean;
};

const seed = (rows: readonly Seed[]) =>
  admin.searchEntry.createMany({
    data: rows.map((row) => ({
      entityType: row.type,
      entityId: row.id,
      title: row.title,
      code: row.code ?? null,
      subtitle: row.subtitle ?? null,
      body: row.body ?? null,
      status: row.status ?? null,
      archived: row.archived ?? false,
    })),
  });

const criteria = (text: string, over: Partial<SearchCriteria> = {}): SearchCriteria => ({
  text,
  types: ALL,
  includeArchived: false,
  ...over,
});
const ids = async (text: string, over: Partial<SearchCriteria> = {}, limit = 50) =>
  (await reader.search(criteria(text, over), limit)).hits.map((hit) => hit.entityId);

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(() => truncateBusinessTables(admin), 60_000);

describe('PrismaSearchRead: matching (HU-26)', () => {
  it('CA1: "garcia" finds "García" and an accented query finds the plain title', async () => {
    await seed([
      { type: 'CLIENT', id: 'c_garcia', title: 'Talleres García' },
      { type: 'CLIENT', id: 'c_plain', title: 'Gestion Integral' },
      { type: 'CLIENT', id: 'c_other', title: 'Otro Cliente' },
    ]);
    expect(await ids('garcia')).toContain('c_garcia');
    expect(await ids('GARCÍA')).toContain('c_garcia');
    expect(await ids('gestión')).toContain('c_plain');
    expect(await ids('garcia')).not.toContain('c_other');
  });

  it('CA2 (A10): "invsion" finds "Inversión Digital" by word similarity against a long title', async () => {
    await seed([
      { type: 'CLIENT', id: 'c_inv', title: 'Inversión Digital' },
      {
        type: 'CLIENT',
        id: 'c_long',
        title: 'Grupo Empresarial Latinoamericano de Inversión y Desarrollo',
      },
      { type: 'CLIENT', id: 'c_far', title: 'Panadería Central' },
    ]);
    const found = await ids('invsion');
    expect(found).toContain('c_inv');
    expect(found).toContain('c_long');
    expect(found).not.toContain('c_far');
  });

  it('matches the code, subtitle and body through the tsvector, by word prefix', async () => {
    await seed([
      { type: 'PROJECT', id: 'p_code', title: 'Portal', code: 'PRY-0042' },
      { type: 'INVOICE', id: 'i_sub', title: 'KAI-0009', subtitle: 'Kairos Studio' },
      { type: 'NOTE', id: 'n_body', title: 'Minuta', body: 'Acordamos la integración de pagos' },
    ]);
    expect(await ids('PRY-0042')).toContain('p_code');
    expect(await ids('kair')).toContain('i_sub');
    expect(await ids('integracion pag')).toContain('n_body');
  });

  it('a multi-word text needs every word in the entry', async () => {
    await seed([
      { type: 'CLIENT', id: 'c_both', title: 'Kairos Studio' },
      { type: 'CLIENT', id: 'c_one', title: 'Kairos Holdings' },
    ]);
    expect(await ids('kairos studio')).toEqual(expect.arrayContaining(['c_both']));
  });

  it('ranks a title match above a body-only match and breaks ties by title then id', async () => {
    await seed([
      { type: 'NOTE', id: 'n_body', title: 'Minuta semanal', body: 'revisar contrato' },
      { type: 'DOCUMENT', id: 'd_title', title: 'Contrato marco' },
      { type: 'DOCUMENT', id: 'd_b', title: 'Contrato B' },
      { type: 'DOCUMENT', id: 'd_a', title: 'Contrato B' },
    ]);
    const found = await ids('contrato');
    expect(found.slice(0, 3)).toEqual(expect.arrayContaining(['d_title', 'd_a', 'd_b']));
    expect(found.indexOf('n_body')).toBeGreaterThan(found.indexOf('d_title'));
    expect(found.indexOf('d_a')).toBeLessThan(found.indexOf('d_b'));
  });
});

describe('PrismaSearchRead: exact code (HU-26 CA3)', () => {
  it('finds a record by its code in any case, and an invoice by its fiscal number (title)', async () => {
    await seed([
      { type: 'INVOICE', id: 'i3', title: 'KAI-0001', code: 'FAC-0003' },
      { type: 'INVOICE', id: 'i4', title: 'KAI-0002', code: 'FAC-0004' },
      { type: 'CLIENT', id: 'c1', title: 'FAC-0003 Studio' },
    ]);
    expect((await reader.findExact(criteria('fac-0003')))?.entityId).toBe('i3');
    expect((await reader.findExact(criteria('kai-0002')))?.entityId).toBe('i4');
    expect(await reader.findExact(criteria('fac-000'))).toBeNull();
  });

  it('a non-invoice title equal to the text is not an exact hit, and archived ones need the flag', async () => {
    await seed([
      { type: 'CLIENT', id: 'c1', title: 'FAC-0009' },
      { type: 'INVOICE', id: 'i_old', title: 'KAI-7', code: 'FAC-0007', archived: true },
    ]);
    expect(await reader.findExact(criteria('FAC-0009'))).toBeNull();
    expect(await reader.findExact(criteria('FAC-0007'))).toBeNull();
    expect(
      (await reader.findExact(criteria('FAC-0007', { includeArchived: true })))?.entityId,
    ).toBe('i_old');
  });

  it('respects the allowed types', async () => {
    await seed([{ type: 'INVOICE', id: 'i3', title: 'KAI-1', code: 'FAC-0003' }]);
    expect(await reader.findExact(criteria('FAC-0003', { types: ['CLIENT', 'NOTE'] }))).toBeNull();
  });
});

describe('PrismaSearchRead: shape, limit and visibility', () => {
  it('caps the hits in total while each type keeps its total', async () => {
    await seed([
      ...Array.from({ length: 6 }, (_, i) => ({
        type: 'CLIENT' as const,
        id: `c${i}`,
        title: `Alfa ${i}`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        type: 'NOTE' as const,
        id: `n${i}`,
        title: `Alfa nota ${i}`,
      })),
    ]);
    const result = await reader.search(criteria('alfa'), 3);
    expect(result.hits).toHaveLength(3);
    expect(result.totals).toEqual({ CLIENT: 6 });
    const wide = await reader.search(criteria('alfa'), 50);
    expect(wide.hits).toHaveLength(10);
    expect(wide.totals).toEqual({ CLIENT: 6, NOTE: 4 });
  });

  it('returns the columns of the hit', async () => {
    await seed([
      {
        type: 'INVOICE',
        id: 'i1',
        title: 'KAI-1',
        code: 'FAC-1',
        subtitle: 'Kairos',
        status: 'EMITIDA',
      },
    ]);
    const { hits } = await reader.search(criteria('kairos'), 5);
    expect(hits).toEqual([
      {
        entityType: 'INVOICE',
        entityId: 'i1',
        code: 'FAC-1',
        title: 'KAI-1',
        subtitle: 'Kairos',
        status: 'EMITIDA',
        archived: false,
      },
    ]);
  });

  it('searches only the requested types', async () => {
    await seed([
      { type: 'CLIENT', id: 'c1', title: 'Kairos' },
      { type: 'INVOICE', id: 'i1', title: 'Kairos factura' },
    ]);
    expect(await ids('kairos', { types: ['CLIENT'] })).toEqual(['c1']);
    expect(await ids('kairos', { types: ['INVOICE'] })).toEqual(['i1']);
  });

  it('hides archived entries unless asked (HU-28 CA1)', async () => {
    await seed([
      { type: 'CLIENT', id: 'c_live', title: 'Veredas Vivas' },
      { type: 'CLIENT', id: 'c_old', title: 'Veredas Digital', archived: true },
    ]);
    expect(await ids('veredas')).toEqual(['c_live']);
    const all = await reader.search(criteria('veredas', { includeArchived: true }), 10);
    expect(all.hits.map((hit) => hit.entityId).sort()).toEqual(['c_live', 'c_old']);
    expect(all.hits.find((hit) => hit.entityId === 'c_old')?.archived).toBe(true);
    expect(all.totals).toEqual({ CLIENT: 2 });
  });

  it('answers nothing for text with no words or no similarity', async () => {
    await seed([{ type: 'CLIENT', id: 'c1', title: 'Kairos' }]);
    expect(await ids('!!!')).toEqual([]);
    expect(await ids('zzzzqq')).toEqual([]);
  });
});

describe('PrismaSearchRead: user text is inert', () => {
  const hostile = [
    'http://x.y/z?q=1&a=b',
    'ana@example.com',
    'C:\\\\dir\\\\file',
    "it's",
    '-0042',
    '(((',
    '<->',
    '😀 emoji',
    `'; DROP TABLE "SearchEntry"; --`,
    `" OR 1=1 --`,
    `kairos' & !studio | (a:*) <-> b`,
    `\\`,
    `)(`,
    `%_`,
    `a:* & b:*`,
    `${'x'.repeat(200)}`,
    `\u0000kairos`,
  ];

  it.each(hostile)('%j neither errors nor changes the table', async (text) => {
    await seed([{ type: 'CLIENT', id: 'c1', title: 'Kairos Studio' }]);
    await expect(reader.search(criteria(text), 10)).resolves.toBeDefined();
    await expect(reader.findExact(criteria(text))).resolves.toBeNull();
    expect(await admin.searchEntry.count()).toBe(1);
  });

  it('does not treat % or _ as wildcards', async () => {
    await seed([{ type: 'CLIENT', id: 'c1', title: 'Kairos Studio' }]);
    expect(await ids('%')).toEqual([]);
    expect(await ids('k_iros')).not.toContain('c1x');
  });
});

describe('PrismaSearchRead: p95 on 10,000 entries (PRD §14 target < 200 ms)', () => {
  it('measures the ranked search and the exact lookup', async () => {
    const words = [
      'Kairos',
      'Solaris',
      'Veredas',
      'Inversión',
      'Digital',
      'Talleres',
      'García',
      'Estudio',
      'Portal',
      'Contrato',
      'Factura',
      'Servicios',
      'Mantenimiento',
      'Consultoría',
      'Desarrollo',
      'Plataforma',
      'Marketing',
      'Logística',
      'Energía',
      'Tecnología',
    ];
    const types = SEARCHABLE_ENTITY_TYPE_VALUES;
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      entityType: types[i % types.length] as SearchableEntityType,
      entityId: `e${String(i).padStart(5, '0')}`,
      code: i % 3 === 0 ? `COD-${String(i).padStart(5, '0')}` : null,
      title: `${words[i % words.length]} ${words[(i * 7 + 3) % words.length]} ${i}`,
      subtitle: words[(i * 11 + 5) % words.length] ?? null,
      body:
        i % 5 === 0
          ? `${words[(i * 3) % words.length]} ${words[(i * 13) % words.length]} detalle`
          : null,
      status: null,
      archived: i % 50 === 0,
    }));
    await admin.searchEntry.createMany({ data: rows });
    await admin.$executeRawUnsafe('ANALYZE "SearchEntry"');

    const samples = [
      'kairos',
      'inversion',
      'invsion',
      'garcia estudio',
      'c',
      'mantenim',
      'logistica 42',
    ];
    const timings: number[] = [];
    const bySample: Record<string, number[]> = {};
    for (let round = 0; round < 12; round += 1) {
      for (const text of samples) {
        const started = performance.now();
        await reader.search(criteria(text), 20);
        const took = performance.now() - started;
        timings.push(took);
        (bySample[text] ??= []).push(took);
      }
    }
    const exactTimings: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const started = performance.now();
      await reader.findExact(criteria(`COD-${String(i * 3).padStart(5, '0')}`));
      exactTimings.push(performance.now() - started);
    }
    const p95 = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? 0;
    process.stdout.write(
      `SEARCH_P95 ranked=${p95(timings).toFixed(1)}ms exact=${p95(exactTimings).toFixed(1)}ms over ${rows.length} entries; ` +
        Object.entries(bySample)
          .map(([text, values]) => `${text}=${p95(values).toFixed(0)}ms`)
          .join(' ') +
        '\n',
    );
    expect(p95(timings)).toBeLessThan(200);
    expect(p95(exactTimings)).toBeLessThan(200);
  }, 120_000);
});
