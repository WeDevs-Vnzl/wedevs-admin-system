import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { ReportsModule } from '../../../src/modules/intelligence/reports.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { buildWorld } from '../../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { createTestApp } from '../../support/test-app';
import { NOW } from './reports-world';
import { seedReportsStudio } from './seed';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

/* eslint-disable @typescript-eslint/no-explicit-any */
type Body = any;

describe('reports and KPIs (e2e)', () => {
  let app: NestExpressApplication;
  const tokens: Partial<Record<UserRole, string>> = {};
  let ids: Awaited<ReturnType<typeof seedReportsStudio>>;

  const get = (role: UserRole | null, path: string) => {
    const call = request(app.getHttpServer()).get(`/api/v1${path}`);
    return role ? call.set('Authorization', `Bearer ${tokens[role]}`) : call;
  };
  const report = async (slug: string, query = ''): Promise<Body> => {
    const res = await get('OWNER', `/reports/${slug}${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  const kpis = async (query = ''): Promise<Record<string, Body>> => {
    const res = await get('OWNER', `/reports/kpis${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return Object.fromEntries((res.body.kpis as Body[]).map((k) => [k.id, k]));
  };

  beforeAll(async () => {
    await truncateBusinessTables(admin);
    await admin.expenseCategory.deleteMany({ where: { id: 'cat-child' } });
    ids = await seedReportsStudio(buildWorld(service), admin);
    // The VES balance is valued at the latest rate on or before today (Oct 9).
    await admin.exchangeRate.create({
      data: { date: new Date('2026-10-08'), currency: 'VES', usdRate: '36', source: 'MANUAL' },
    });
    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [ReportsModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: CLOCK, useValue: new FixedClock(NOW) },
      ],
    });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.upsert({
        where: { clerkId: `clerk_reports_${role}` },
        update: {},
        create: {
          clerkId: `clerk_reports_${role}`,
          email: `${role}@reports.test`,
          name: role,
          role,
        },
      });
      const user: CurrentUser = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      tokens[role] = authenticator.issue(user);
    }
  }, 180_000);
  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(admin);
    await admin.expenseCategory.deleteMany({ where: { id: 'cat-child' } });
    await service.client.$disconnect();
    await admin.$disconnect();
  });

  describe('access and input', () => {
    it('answers 401 without a token and FORBIDDEN to Member and Viewer on every route', async () => {
      expect((await get(null, '/reports/kpis')).status).toBe(401);
      expect((await get(null, '/reports/collected-by-month')).status).toBe(401);
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        for (const path of ['/reports/kpis', '/reports/collected-by-month', '/reports/nope']) {
          const res = await get(role, path);
          expect(res.status, `${role} ${path}`).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
      expect((await get('ADMIN', '/reports/kpis')).status).toBe(200);
    });

    it('declares /reports/kpis before /reports/:slug', async () => {
      const res = await get('OWNER', '/reports/kpis');
      expect(res.body.kpis).toHaveLength(18);
      expect(res.body.reportId).toBeUndefined();
    });

    it('an unknown slug is NOT_FOUND', async () => {
      const res = await get('OWNER', '/reports/not-a-report');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects a bad preset, an inverted range and a missing custom bound with i18n keys', async () => {
      let res = await get('OWNER', '/reports/collected-by-month?preset=DECADE');
      expect(res.status).toBe(422);
      expect(res.body.error.fieldErrors.preset).toEqual(['reports.validation.preset']);
      res = await get('OWNER', '/reports/kpis?preset=CUSTOM&from=2026-10-05&to=2026-09-01');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.fieldErrors.to).toEqual(['reports.validation.rangeInverted']);
      res = await get('OWNER', '/reports/kpis?preset=CUSTOM&from=2026-10-05');
      expect(res.body.error.fieldErrors.to).toEqual(['reports.validation.customRangeRequired']);
      res = await get('OWNER', '/reports/kpis?preset=CUSTOM&from=2000-01-01&to=2026-10-05');
      expect(res.body.error.fieldErrors.to).toEqual(['reports.validation.rangeTooLong']);
    });

    it('resolves the client, project and tag ids (C14): unknown or deleted is NOT_FOUND', async () => {
      for (const query of [
        'clientId=cli_ghost',
        'clientId=cli_gone',
        'projectId=pry_dead',
        'tagId=tag_ghost',
      ]) {
        const res = await get('OWNER', `/reports/kpis?${query}`);
        expect(res.status, query).toBe(404);
      }
      // A malformed id never reaches a query.
      const bad = await get('OWNER', "/reports/kpis?clientId=x'%20OR%20'1'='1");
      expect(bad.status).toBe(422);
    });
  });

  describe('HU-31 CA1: the eighteen KPIs on a known fixture (October 9, 2026)', () => {
    // Collected is the allocated USD of confirmed payments by payment date (DT-98): pay_1 is 253 with 3 of
    // IGTF and collects 250 against inv_1, where the mock summed the payment amount. Receivable is billed
    // minus withheld minus collected on the due date (DT-125): inv_1 is 1,160 - 20 - 250 = 890.
    it('returns the range, the period before and the 18 cards in order', async () => {
      const res = await get('OWNER', '/reports/kpis?preset=THIS_MONTH');
      expect(res.body.range).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
      expect(res.body.previousRange).toEqual({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
      expect((res.body.kpis as Body[]).map((k) => k.id)).toEqual([
        'MRR',
        'ARR',
        'DSO',
        'COLLECTION_RATE',
        'DELINQUENCY',
        'PROJECT_MARGIN',
        'OPERATING_MARGIN',
        'FIXED_MONTHLY_EXPENSE',
        'RUNWAY',
        'REVENUE_CONCENTRATION',
        'AVG_PROJECT_TICKET',
        'CLIENT_LTV',
        'NEW_CLIENTS',
        'PROSPECT_CONVERSION',
        'AVG_PROJECT_DURATION',
        'ON_TIME_PROJECTS',
        'STACK_USAGE',
        'DOCUMENT_COVERAGE',
      ]);
    });

    it('recurring revenue and expense', async () => {
      const k = await kpis('?preset=THIS_MONTH');
      expect(k.MRR).toMatchObject({
        unit: 'USD',
        value: '100.00',
        previousValue: '100.00',
        changePercent: '0.00',
      });
      expect(k.ARR).toMatchObject({ value: '1200.00', previousValue: '1200.00' });
      expect(k.FIXED_MONTHLY_EXPENSE).toMatchObject({ value: '42.50', previousValue: '42.50' });
      expect(k.MRR.sparkline).toHaveLength(12);
      expect(k.MRR.sparkline.slice(-3)).toEqual([
        { period: '2026-08', value: '150.00' },
        { period: '2026-09', value: '100.00' },
        { period: '2026-10', value: '100.00' },
      ]);
    });

    it('collection, receivable and margin ratios', async () => {
      const k = await kpis('?preset=THIS_MONTH');
      // 1,466 receivable / 1,296 billed * 31 days; the previous month 440 / 540 * 30.
      expect(k.DSO).toMatchObject({
        unit: 'DAYS',
        value: '35.07',
        previousValue: '24.44',
        changePercent: '43.49',
      });
      expect(k.COLLECTION_RATE).toMatchObject({
        unit: 'PERCENT',
        value: '19.29',
        previousValue: '18.52',
        changePercent: '4.16',
      });
      expect(k.COLLECTION_RATE.sparkline).toEqual([
        { period: '2026-09', value: '18.52' },
        { period: '2026-10', value: '19.29' },
      ]);
      expect(k.DELINQUENCY).toMatchObject({
        value: '30.01',
        previousValue: '100.00',
        changePercent: '-69.99',
      });
      expect(k.OPERATING_MARGIN).toMatchObject({
        value: '80.00',
        previousValue: '80.00',
        changePercent: '0.00',
      });
      expect(k.PROJECT_MARGIN).toMatchObject({
        value: '80.00',
        previousValue: '100.00',
        changePercent: '-20.00',
      });
      expect(k.PROJECT_MARGIN.breakdown).toEqual([
        { key: 'pry_a', label: 'pry_a', value: '80.00' },
      ]);
    });

    it('runway: the VES balance at the latest rate over the last three months of expenses', async () => {
      const k = await kpis('?preset=THIS_MONTH');
      // 1,000 USD + 3,600 VES / 36 = 1,100; Aug-Oct expenses 70 / 3 = 23.33; previous Jul-Sep 20 / 3 = 6.67.
      expect(k.RUNWAY).toMatchObject({
        unit: 'MONTHS',
        value: '47.15',
        previousValue: '164.92',
        changePercent: '-71.41',
      });
    });

    it('concentration, LTV, ticket and client lifecycle', async () => {
      const k = await kpis('?preset=THIS_MONTH');
      expect(k.REVENUE_CONCENTRATION).toMatchObject({
        value: '71.43',
        previousValue: '100.00',
        changePercent: '-28.57',
      });
      expect(k.REVENUE_CONCENTRATION.breakdown).toEqual([
        { key: 'top1', value: '71.43' },
        { key: 'top3', value: '100.00' },
      ]);
      expect(k.CLIENT_LTV).toMatchObject({
        value: '175.00',
        previousValue: '100.00',
        changePercent: '75.00',
      });
      expect(k.CLIENT_LTV.breakdown).toEqual([
        { key: 'cli_a', label: 'Kairos', value: '250.00' },
        { key: 'cli_b', label: 'Zafiro', value: '100.00' },
      ]);
      expect(k.AVG_PROJECT_TICKET).toMatchObject({
        value: '3000.00',
        previousValue: null,
        changePercent: null,
      });
      // cli_a was activated on October 3 in Caracas (October 4, 03:00Z).
      expect(k.NEW_CLIENTS).toMatchObject({
        unit: 'COUNT',
        value: '1',
        previousValue: '0',
        changePercent: null,
      });
      expect(k.PROSPECT_CONVERSION).toMatchObject({ value: '100.00', previousValue: null });
    });

    it('delivery, stack and document coverage', async () => {
      const k = await kpis('?preset=THIS_MONTH');
      expect(k.AVG_PROJECT_DURATION).toMatchObject({
        unit: 'DAYS',
        value: null,
        previousValue: '40.00',
        changePercent: null,
      });
      expect(k.ON_TIME_PROJECTS).toMatchObject({ value: null, previousValue: '0.00' });
      expect(k.STACK_USAGE.value).toBe('2');
      expect(k.STACK_USAGE.breakdown).toHaveLength(2);
      expect(k.STACK_USAGE.breakdown[0]).toMatchObject({ value: '1' });
      expect(k.STACK_USAGE.breakdown[0].label).toEqual(expect.any(String));
      // pry_a has a signed contract through its client, but its NDA expired on October 1.
      expect(k.DOCUMENT_COVERAGE).toMatchObject({
        value: '0.00',
        previousValue: '100.00',
        changePercent: '-100.00',
      });
    });

    it('HU-31 CA2: another range moves the value, the comparison and the sparkline end', async () => {
      const oct = await kpis('?preset=THIS_MONTH');
      const sep = await kpis('?preset=PREVIOUS_MONTH');
      expect(sep.COLLECTION_RATE.value).toBe('18.52');
      expect(sep.DSO.value).toBe('24.44');
      expect(sep.COLLECTION_RATE.value).not.toBe(oct.COLLECTION_RATE.value);
      expect(sep.DSO.value).not.toBe(oct.DSO.value);
      expect(sep.COLLECTION_RATE.sparkline.at(-1)?.period).toBe('2026-09');
      expect(oct.COLLECTION_RATE.sparkline.at(-1)?.period).toBe('2026-10');
      // October compares against what September's own card says.
      for (const id of [
        'MRR',
        'ARR',
        'DSO',
        'COLLECTION_RATE',
        'DELINQUENCY',
        'OPERATING_MARGIN',
        'PROJECT_MARGIN',
        'RUNWAY',
      ]) {
        expect(oct[id].previousValue, id).toBe(sep[id].value);
      }
      const custom = await kpis('?preset=CUSTOM&from=2026-10-01&to=2026-10-09');
      expect(custom.COLLECTION_RATE.value).toBe('19.29');
    });

    it('a client filter narrows the cards', async () => {
      const k = await kpis('?preset=THIS_MONTH&clientId=cli_b');
      expect(k.COLLECTION_RATE.value).toBeNull();
      expect(k.COLLECTION_RATE.previousValue).toBe('18.52');
      expect(k.MRR.value).toBe('0.00');
      expect(k.NEW_CLIENTS.value).toBe('0');
    });

    it('a tag filter reaches clients and projects through TagAssignment', async () => {
      const byClientTag = await kpis('?preset=THIS_MONTH&tagId=tag_a');
      expect(byClientTag.COLLECTION_RATE.value).toBe('19.29');
      const byProjectTag = await kpis('?preset=THIS_MONTH&tagId=tag_p');
      expect(byProjectTag.COLLECTION_RATE.value).toBeNull();
      expect(byProjectTag.COLLECTION_RATE.previousValue).toBe('18.52');
    });
  });

  describe('the ten reports', () => {
    it('collected by month and billed vs collected follow the allocations', async () => {
      const collected = await report('collected-by-month');
      expect(collected.reportId).toBe('COLLECTED_BY_MONTH');
      expect(collected.currency).toBe('USD');
      expect(collected.range).toEqual({ dateFrom: '2025-11-01', dateTo: '2026-10-31' });
      expect(collected.points).toHaveLength(12);
      expect(collected.points.slice(-2)).toEqual([
        { period: '2026-09', value: '100.00' },
        { period: '2026-10', value: '250.00' },
      ]);
      const versus = await report('billed-vs-collected');
      const series = Object.fromEntries(
        (versus.chart.series as Body[]).map((s) => [s.id, s.values.slice(-2)]),
      );
      expect(series).toEqual({ billed: ['540.00', '1296.00'], collected: ['100.00', '250.00'] });
    });

    it('revenue by client and by project', async () => {
      const byClient = await report('revenue-by-client');
      expect(
        (byClient.rows as Body[]).map((r) => [r.client.id, r.client.label, r.collected, r.billed]),
      ).toEqual([
        ['cli_a', 'Kairos', '250.00', '1296.00'],
        ['cli_b', 'Zafiro', '100.00', '540.00'],
      ]);
      expect(byClient.rows[0].client.type).toBe('CLIENT');
      const byProject = await report('revenue-by-project');
      expect(
        (byProject.rows as Body[]).map((r) => [
          r.project.id,
          r.collected,
          r.margin,
          r.marginPercent,
        ]),
      ).toEqual([
        ['pry_a', '250.00', '200.00', '80.00'],
        ['pry_b', '100.00', '100.00', '100.00'],
      ]);
    });

    it('receivables aging is on the due date, net of withholdings (DT-125)', async () => {
      const aging = await report('receivables-aging');
      expect(aging.totals).toEqual({
        d0_30: '1466.00',
        d31_60: '0.00',
        d61_90: '0.00',
        d90plus: '0.00',
      });
      expect((aging.rows as Body[]).map((r) => [r.client.id, r.total])).toEqual([
        ['cli_a', '1026.00'],
        ['cli_b', '440.00'],
      ]);
      // A range that closed on Sep 30 sees only inv_2, 5 days past due.
      const past = await report(
        'receivables-aging',
        '?preset=CUSTOM&from=2026-09-01&to=2026-09-30',
      );
      expect(past.totals.d0_30).toBe('440.00');
    });

    it('expenses by month and root category, net result and account flow', async () => {
      const expenses = await report('expenses-by-month-category');
      expect(expenses.chart.periods).toHaveLength(12);
      expect(expenses.chart.series).toEqual([
        { id: ids.rootCategoryId, label: 'Infraestructura', values: expect.any(Array) },
      ]);
      expect(expenses.chart.series[0].values.slice(-2)).toEqual(['20.00', '50.00']);
      const net = await report('net-result-monthly');
      expect(net.points.slice(-2)).toEqual([
        { period: '2026-09', value: '80.00' },
        { period: '2026-10', value: '200.00' },
      ]);
      const flow = await report('account-flow');
      expect(
        (flow.rows as Body[]).map((r) => [r.account.id, r.period, r.inflow, r.outflow]),
      ).toEqual([
        ['acc_usd', '2026-09', '300.00', '105.00'],
        ['acc_ves', '2026-09', '30.00', '0.00'],
        ['acc_usd', '2026-10', '250.00', '50.00'],
      ]);
    });

    it('collections by method with their share', async () => {
      const methods = await report('collections-by-method');
      expect(methods.rows).toEqual([
        {
          methodId: ids.methodId,
          methodCode: expect.any(String),
          collected: '350.00',
          share: '100.00',
        },
      ]);
    });

    it('taxes registered: IVA per rate (DT-44), withholdings and IGTF', async () => {
      const taxes = await report('taxes-registered', '?preset=THIS_MONTH');
      expect(taxes.months.map((m: Body) => m.period)).toEqual(['2026-10']);
      expect(taxes.totals.ivaByRate).toEqual([
        { ivaRate: '16.00', taxBase: '1100.00', ivaAmount: '176.00' },
        { ivaRate: '0.00', taxBase: '20.00', ivaAmount: '0.00' },
      ]);
      expect(taxes.totals).toMatchObject({
        ivaTotal: '176.00',
        ivaWithheld: '20.00',
        islrWithheld: '0.00',
        otherWithheld: '0.00',
        igtf: '3.00',
      });
      expect(taxes.months[0].ivaByRate).toEqual(taxes.totals.ivaByRate);
    });

    it('the filters narrow a report', async () => {
      const byClient = await report('collected-by-month', '?clientId=cli_b');
      expect(byClient.points.slice(-2)).toEqual([
        { period: '2026-09', value: '100.00' },
        { period: '2026-10', value: '0.00' },
      ]);
      const byProject = await report('revenue-by-client', '?projectId=pry_a');
      expect((byProject.rows as Body[]).map((r) => r.client.id)).toEqual(['cli_a']);
      const byTag = await report('revenue-by-client', '?tagId=tag_p');
      expect((byTag.rows as Body[]).map((r) => r.client.id)).toEqual(['cli_b']);
      // Expenses carry no client: a net result under a client filter has no answer.
      const net = await report('net-result-monthly', '?clientId=cli_a');
      expect(net.points.slice(-1)).toEqual([{ period: '2026-10', value: null }]);
    });

    it('an empty range answers zeros, never an error', async () => {
      const empty = await report(
        'revenue-by-client',
        '?preset=CUSTOM&from=2020-01-01&to=2020-01-31',
      );
      expect(empty.rows).toEqual([]);
      const flow = await report('account-flow', '?preset=CUSTOM&from=2020-01-01&to=2020-01-31');
      expect(flow.rows).toEqual([]);
      const taxes = await report(
        'taxes-registered',
        '?preset=CUSTOM&from=2020-01-01&to=2020-01-31',
      );
      expect(taxes.months).toEqual([
        expect.objectContaining({ period: '2020-01', ivaByRate: [], ivaTotal: '0.00' }),
      ]);
    });
  });
});
