import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaFinanceFactsRead } from '../../../src/modules/intelligence/infrastructure/prisma-finance-facts-read';
import { PrismaReportInputsRead } from '../../../src/modules/intelligence/infrastructure/prisma-report-inputs-read';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { buildWorld } from '../../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { seedReportsStudio } from './seed';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const world = buildWorld(service);
const read = new PrismaReportInputsRead(world.host);
const facts = new PrismaFinanceFactsRead(world.host);
let ids: Awaited<ReturnType<typeof seedReportsStudio>>;

beforeAll(async () => {
  await truncateBusinessTables(admin);
  await admin.expenseCategory.deleteMany({ where: { id: 'cat-child' } });
  ids = await seedReportsStudio(world, admin);
}, 120_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await admin.expenseCategory.deleteMany({ where: { id: 'cat-child' } });
  await service.client.$disconnect();
  await admin.$disconnect();
});

const SEP_OCT = { from: '2026-09-01', to: '2026-10-31' };

describe('exists and labels', () => {
  it('resolves live records only (C14)', async () => {
    expect(await read.exists('CLIENT', 'cli_a')).toBe(true);
    expect(await read.exists('CLIENT', 'cli_gone')).toBe(false);
    expect(await read.exists('CLIENT', 'cli_ghost')).toBe(false);
    expect(await read.exists('PROJECT', 'pry_a')).toBe(true);
    expect(await read.exists('PROJECT', 'pry_dead')).toBe(false);
    expect(await read.exists('TAG', 'tag_a')).toBe(true);
    expect(await read.exists('TAG', 'tag_ghost')).toBe(false);
    expect(await read.exists('PROJECT', "x' OR '1'='1")).toBe(false);
  });

  it('labels each kind; deleted records keep their names', async () => {
    const clients = await read.labels('CLIENT', ['cli_a', 'cli_gone', 'cli_ghost']);
    expect(clients.map((c) => [c.id, c.label]).sort()).toEqual([
      ['cli_a', 'Kairos'],
      ['cli_gone', 'cli_gone'],
    ]);
    expect(clients.find((c) => c.id === 'cli_a')?.code).toMatch(/^CLI-/);
    expect(await read.labels('PROJECT', ['pry_dead'])).toHaveLength(1);
    expect(await read.labels('ACCOUNT', ['acc_usd'])).toEqual([
      { id: 'acc_usd', label: 'acc_usd', code: null },
    ]);
    expect(await read.labels('CATEGORY', ['cat-child'])).toEqual([
      { id: 'cat-child', label: 'Child', code: null },
    ]);
    const methods = await read.labels('METHOD', [ids.methodId]);
    expect(methods[0]?.code).toBeTruthy();
    expect(await read.labels('TECHNOLOGY', ids.technologyIds)).toHaveLength(2);
    expect(await read.labels('CLIENT', [])).toEqual([]);
  });
});

describe('expensesByMonthCategory', () => {
  it('groups paid expenses by month and root category; pending adds nothing', async () => {
    const rows = await read.expensesByMonthCategory(SEP_OCT, {});
    expect(rows.sort((a, b) => a.month.localeCompare(b.month))).toEqual([
      { categoryId: ids.rootCategoryId, month: '2026-09', amountUsd: '20.00' },
      { categoryId: ids.rootCategoryId, month: '2026-10', amountUsd: '50.00' },
    ]);
  });

  it('narrows by project', async () => {
    expect(await read.expensesByMonthCategory(SEP_OCT, { projectId: 'pry_a' })).toEqual([
      { categoryId: ids.rootCategoryId, month: '2026-10', amountUsd: '50.00' },
    ]);
  });
});

describe('accountFlow', () => {
  it('sums inflows and outflows per account and month from the facts', async () => {
    const rows = await read.accountFlow(SEP_OCT, {});
    const by = Object.fromEntries(rows.map((r) => [`${r.accountId}|${r.month}`, r]));
    // Sep acc_usd in: payment 100 + movement 200; out: expense 20 + transfer 30 + withdrawal 40 + adjustment 15.
    expect(by['acc_usd|2026-09']).toMatchObject({ inflowUsd: '300.00', outflowUsd: '105.00' });
    expect(by['acc_usd|2026-10']).toMatchObject({ inflowUsd: '250.00', outflowUsd: '50.00' });
    expect(by['acc_ves|2026-09']).toMatchObject({ inflowUsd: '30.00', outflowUsd: '0.00' });
  });

  it('a client filter leaves out what belongs to no client', async () => {
    expect(await read.accountFlow(SEP_OCT, { clientId: 'cli_a' })).toEqual([
      { accountId: 'acc_usd', month: '2026-10', inflowUsd: '250.00', outflowUsd: '0.00' },
    ]);
  });
});

describe('taxesByMonth', () => {
  it('IVA per rate with the base in USD at the invoice rate, withholdings and IGTF', async () => {
    const taxes = await read.taxesByMonth(SEP_OCT, {});
    const sorted = taxes.rates.sort(
      (a, b) => a.month.localeCompare(b.month) || a.ivaRate.localeCompare(b.ivaRate),
    );
    expect(sorted).toEqual([
      { month: '2026-09', ivaRate: '8.00', taxBaseUsd: '500.00', ivaAmountUsd: '40.00' },
      // inv_1 1,000 @16 + inv_3 3,600 VES / 36 = 100 @16; inv_3's 720 VES / 36 = 20 @0 has no IVA fact.
      { month: '2026-10', ivaRate: '0.00', taxBaseUsd: '20.00', ivaAmountUsd: '0.00' },
      { month: '2026-10', ivaRate: '16.00', taxBaseUsd: '1100.00', ivaAmountUsd: '176.00' },
    ]);
    expect(taxes.withholdings).toEqual([
      {
        month: '2026-10',
        ivaWithheldUsd: '20.00',
        islrWithheldUsd: '0.00',
        otherWithheldUsd: '0.00',
        igtfUsd: '3.00',
      },
    ]);
  });

  it('A7: the IVA read equals the tax lines of the issued invoices, per rate, in USD at the snapshot', async () => {
    const taxes = await read.taxesByMonth(SEP_OCT, {});
    const fromRead = new Map<string, number>();
    for (const row of taxes.rates) {
      fromRead.set(row.ivaRate, (fromRead.get(row.ivaRate) ?? 0) + Number(row.ivaAmountUsd));
    }
    const lines = await admin.$queryRaw<{ rate: string; usd: string }[]>`
      SELECT tl."ivaRate"::numeric(5,2)::text AS "rate",
             SUM(ROUND(tl."ivaAmount" / i."usdRate", 2))::numeric(38,2)::text AS "usd"
      FROM "InvoiceTaxLine" tl JOIN "Invoice" i ON i.id = tl."invoiceId"
      WHERE i."isDraft" = false AND i.status NOT IN ('BORRADOR', 'ANULADA') AND i."deletedAt" IS NULL
        AND i."issueDate" BETWEEN '2026-09-01' AND '2026-10-31'
      GROUP BY 1`;
    expect(new Map(lines.map((l) => [l.rate, Number(l.usd)]))).toEqual(fromRead);
    const viaPort = await facts.ivaByRate(SEP_OCT);
    expect(new Map(viaPort.map((r) => [r.ivaRate, Number(r.amountUsd)]))).toEqual(
      new Map([...fromRead].filter(([, usd]) => usd !== 0)),
    );
  });

  it('a project filter counts the whole invoice that has a line on it', async () => {
    const taxes = await read.taxesByMonth(SEP_OCT, { projectId: 'pry_b' });
    expect(taxes.rates).toEqual([
      { month: '2026-09', ivaRate: '8.00', taxBaseUsd: '500.00', ivaAmountUsd: '40.00' },
    ]);
    expect(taxes.withholdings).toEqual([]);
    const forA = await read.taxesByMonth(SEP_OCT, { projectId: 'pry_a' });
    expect(forA.withholdings).toEqual([
      expect.objectContaining({ month: '2026-10', ivaWithheldUsd: '20.00', igtfUsd: '3.00' }),
    ]);
  });

  it('a client filter narrows IGTF through the payment client', async () => {
    const taxes = await read.taxesByMonth(SEP_OCT, { clientId: 'cli_b' });
    expect(taxes.withholdings).toEqual([]);
    expect(taxes.rates.map((r) => r.month)).toEqual(['2026-09']);
  });
});

describe('receivableAt', () => {
  const closes = ['2026-09-30', '2026-10-09', '2026-10-31'];

  it('equals the facts port at every close, with and without a filter (one definition, DT-125)', async () => {
    for (const scope of [
      {},
      { clientId: 'cli_a' },
      { projectId: 'pry_a' },
      { tagId: 'tag_a' },
      { tagId: 'tag_p' },
    ]) {
      const many = await read.receivableAt(closes, scope);
      expect(many.map((r) => r.close)).toEqual(closes);
      for (const row of many) {
        const single = await facts.receivableAt(row.close, scope);
        expect(row, JSON.stringify(scope)).toEqual({ close: row.close, ...single });
      }
    }
  });

  it('known values at Oct 9', async () => {
    // inv_1 1,160 - 20 withheld - 250 collected = 890 (due Oct 20); inv_3 136 (due Nov 5); inv_2 540 - 100 = 440 (overdue).
    const [row] = await read.receivableAt(['2026-10-09'], {});
    expect(row).toEqual({ close: '2026-10-09', totalUsd: '1466.00', overdueUsd: '440.00' });
  });

  it('a close with nothing open is zero', async () => {
    expect(await read.receivableAt(['2020-01-01'], {})).toEqual([
      { close: '2020-01-01', totalUsd: '0.00', overdueUsd: '0.00' },
    ]);
    expect(await read.receivableAt([], {})).toEqual([]);
  });
});

describe('KPI inputs', () => {
  it('collectionsByClientDay: confirmed allocations by client and day, up to a date', async () => {
    expect(await read.collectionsByClientDay('2026-10-31', {})).toEqual(
      expect.arrayContaining([
        { clientId: 'cli_b', date: '2026-09-12', amountUsd: '100.00' },
        { clientId: 'cli_a', date: '2026-10-02', amountUsd: '250.00' },
      ]),
    );
    expect(await read.collectionsByClientDay('2026-09-30', {})).toEqual([
      { clientId: 'cli_b', date: '2026-09-12', amountUsd: '100.00' },
    ]);
    expect(await read.collectionsByClientDay('2026-10-31', { clientId: 'cli_b' })).toHaveLength(1);
  });

  it('projectFlows: collected and spent per project inside each window', async () => {
    const rows = await read.projectFlows(
      [
        { from: '2026-10-01', to: '2026-10-31' },
        { from: '2026-09-01', to: '2026-09-30' },
      ],
      {},
    );
    expect(
      rows.sort((a, b) => a.window - b.window || a.projectId.localeCompare(b.projectId)),
    ).toEqual([
      { window: 0, projectId: 'pry_a', collectedUsd: '250.00', expensesUsd: '50.00' },
      { window: 1, projectId: 'pry_b', collectedUsd: '100.00', expensesUsd: '0.00' },
    ]);
    expect(await read.projectFlows([], {})).toEqual([]);
  });

  it('projectFlows follows the facts filter: expenses belong to no client', async () => {
    const rows = await read.projectFlows([{ from: '2026-10-01', to: '2026-10-31' }], {
      clientId: 'cli_a',
    });
    expect(rows).toEqual([
      { window: 0, projectId: 'pry_a', collectedUsd: '250.00', expensesUsd: '0.00' },
    ]);
  });

  it('recurringCharges: live projects only, narrowed by the project scope', async () => {
    const all = await read.recurringCharges({});
    expect(all.map((c) => c.monthlyAmountUsd).sort()).toEqual(['100.00', '50.00']);
    expect(all.find((c) => c.monthlyAmountUsd === '50.00')).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-09-15',
      status: 'ACTIVO',
    });
    expect(
      (await read.recurringCharges({ clientId: 'cli_a' })).map((c) => c.monthlyAmountUsd),
    ).toEqual(['100.00']);
    expect(
      (await read.recurringCharges({ tagId: 'tag_p' })).map((c) => c.monthlyAmountUsd),
    ).toEqual(['50.00']);
    expect(await read.recurringCharges({ projectId: 'pry_dead' })).toEqual([]);
  });

  it('recurringExpenses: live templates; one without a project only when unscoped', async () => {
    expect((await read.recurringExpenses({})).map((e) => e.monthlyAmountUsd).sort()).toEqual([
      '12.50',
      '30.00',
    ]);
    expect(await read.recurringExpenses({ projectId: 'pry_a' })).toEqual([
      { status: 'ACTIVO', monthlyAmountUsd: '30.00' },
    ]);
    expect(await read.recurringExpenses({ clientId: 'cli_b' })).toEqual([]);
  });

  it('accountBalances: live, active accounts in their own currency', async () => {
    const rows = await read.accountBalances();
    expect(rows.sort((a, b) => a.currency.localeCompare(b.currency))).toEqual([
      { currency: 'USD', balance: '1000.00' },
      { currency: 'VES', balance: '3600.00' },
    ]);
  });

  it('kpiProjects: delivery fields, plan, stack and document coverage inputs', async () => {
    const rows = await read.kpiProjects({});
    expect(rows.map((r) => r.id).sort()).toEqual(['pry_a', 'pry_b']);
    const a = rows.find((r) => r.id === 'pry_a');
    expect(a).toMatchObject({
      status: 'EN_CURSO',
      startDate: '2026-10-02',
      targetEndDate: '2026-12-01',
      endDate: null,
      contractedUsd: '3000.00',
      hasSignedContract: true,
    });
    expect([...(a?.technologyIds ?? [])].sort()).toEqual([...ids.technologyIds].sort());
    // The void NDA and the deleted contract are left out; the contract reaches the project through its client.
    expect(a?.ndaExpiries).toEqual(['2026-10-01']);
    const b = rows.find((r) => r.id === 'pry_b');
    expect(b).toMatchObject({
      endDate: '2026-09-10',
      contractedUsd: null,
      hasSignedContract: false,
    });
    expect(b?.ndaExpiries).toEqual([]);
    expect((await read.kpiProjects({ clientId: 'cli_b' })).map((r) => r.id)).toEqual(['pry_b']);
    expect((await read.kpiProjects({ tagId: 'tag_p' })).map((r) => r.id)).toEqual(['pry_b']);
  });

  it('kpiClients: live clients with their Caracas business days', async () => {
    const rows = await read.kpiClients({});
    expect(rows.map((r) => r.id).sort()).toEqual(['cli_a', 'cli_b']);
    expect(rows.find((r) => r.id === 'cli_a')).toEqual({
      id: 'cli_a',
      createdAt: '2026-10-01',
      activatedAt: '2026-10-03',
    });
    expect(rows.find((r) => r.id === 'cli_b')?.activatedAt).toBeNull();
    expect((await read.kpiClients({ tagId: 'tag_a' })).map((r) => r.id)).toEqual(['cli_a']);
    expect((await read.kpiClients({ projectId: 'pry_b' })).map((r) => r.id)).toEqual(['cli_b']);
  });
});
