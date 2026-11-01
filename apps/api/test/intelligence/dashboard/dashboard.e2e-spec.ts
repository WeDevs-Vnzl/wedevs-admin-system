import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { DashboardModule } from '../../../src/modules/intelligence/dashboard.module';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import { parseDateOnly } from '../../../src/shared/domain/business-date';
import { makeClient, makeDocument, makeInvoice, makeProject } from '../../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { createTestApp } from '../../support/test-app';
import { NOW, TODAY } from './dashboard-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const d = parseDateOnly;

describe('dashboard, shell and summaries (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const clock = new FixedClock(NOW);
  let app: NestExpressApplication;
  const tokens = { owner: '', admin: '', member: '', viewer: '' };
  type Role = keyof typeof tokens;
  const http = () => request(app.getHttpServer());
  const get = (role: Role, path: string) =>
    http().get(`/api/v1${path}`).set('Authorization', `Bearer ${tokens[role]}`);
  const cardsOf = (body: {
    kpis: {
      id: string;
      value: string;
      previousValue: string | null;
      changePercent: string | null;
      secondaryValue: string | null;
    }[];
  }) =>
    Object.fromEntries(
      body.kpis.map((k) => [k.id, [k.value, k.previousValue, k.changePercent, k.secondaryValue]]),
    );

  let clientId = '';
  let projectId = '';

  /** Hand-computed ledger, today 2026-01-15 (the same one as the use-case test). */
  async function seedLedger(): Promise<void> {
    const fact = (
      kind: 'BILLED' | 'COLLECTED' | 'EXPENSE_PAID',
      date: string,
      amountUsd: string,
      extra: { invoiceId?: string; clientId?: string; dueDate?: string } = {},
    ) => ({
      kind,
      date: d(date),
      amountUsd,
      sourceType: kind === 'EXPENSE_PAID' ? ('EXPENSE' as const) : ('INVOICE' as const),
      sourceId: extra.invoiceId ?? `src-${kind}-${date}`,
      invoiceId: extra.invoiceId ?? null,
      clientId: extra.clientId ?? null,
      dueDate: extra.dueDate ? d(extra.dueDate) : null,
    });
    const inv2 = { invoiceId: 'inv2', clientId: 'c1', dueDate: '2025-12-20' };
    const inv1 = { invoiceId: 'inv1', clientId: 'c1', dueDate: '2026-01-05' };
    const inv3 = { invoiceId: 'inv3', clientId: 'c2', dueDate: '2026-02-15' };
    await prisma.financeFact.createMany({
      data: [
        fact('BILLED', '2025-11-20', '300.00', inv2),
        fact('COLLECTED', '2025-11-25', '100.00', inv2),
        fact('EXPENSE_PAID', '2025-11-02', '50.00'),
        fact('BILLED', '2025-12-01', '500.00', inv1),
        fact('COLLECTED', '2025-12-05', '200.00', inv1),
        fact('EXPENSE_PAID', '2025-12-20', '70.00'),
        fact('BILLED', '2026-01-03', '900.00', inv3),
        fact('COLLECTED', '2026-01-05', '400.00', inv3),
        fact('EXPENSE_PAID', '2026-01-08', '120.00'),
        fact('COLLECTED', '2025-06-15', '1000.00'),
        fact('BILLED', '2025-06-15', '2000.00'),
        fact('EXPENSE_PAID', '2025-06-20', '500.00'),
      ],
    });
    const charge = (monthly: string, start: string, end: string | null, status = 'ACTIVO') =>
      prisma.recurringCharge.create({
        data: {
          projectId,
          label: 'c',
          amount: monthly,
          currency: 'USD',
          frequency: 'MENSUAL',
          startDate: d(start),
          endDate: end ? d(end) : null,
          billingDay: 1,
          status: status as 'ACTIVO',
          usdRate: '1',
          monthlyAmountUsd: monthly,
        },
      });
    await charge('100.00', '2025-06-01', null);
    await charge('50.00', '2026-01-10', null);
    await charge('30.00', '2025-01-01', '2025-12-20');
    await charge('20.00', '2025-01-01', null, 'PAUSADO');
    const account = (name: string, currency: string, balance: string) =>
      prisma.account.create({
        data: {
          name,
          type: 'BANCO_NACIONAL',
          currency,
          openingDate: d('2025-01-01'),
          balance,
        },
      });
    await account('usd', 'USD', '1000.00');
    await account('ves', 'VES', '3650.00');
    for (const [name, status, deletedAt] of [
      ['p-a', 'EN_CURSO', null],
      ['p-b', 'EN_CURSO', null],
      ['p-c', 'MANTENIMIENTO', null],
      ['p-d', 'ENTREGADO', null],
      ['p-x', 'EN_CURSO', new Date('2026-01-01')],
    ] as const) {
      await prisma.project.create({
        data: { code: name, name, summary: 's', status, deletedAt },
      });
    }
  }

  beforeAll(async () => {
    app = await createTestApp({
      modules: [DashboardModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: CLOCK, useValue: clock },
      ],
    });
  });

  beforeEach(async () => {
    clock.set(NOW);
    await truncateBusinessTables(prisma);
    await prisma.exchangeRate.deleteMany();
    for (const [tag, role] of [
      ['owner', 'OWNER'],
      ['admin', 'ADMIN'],
      ['member', 'MEMBER'],
      ['viewer', 'VIEWER'],
    ] as const) {
      const row = await prisma.user.create({
        data: { clerkId: `clerk_${tag}`, email: `${tag}@example.test`, name: tag, role },
      });
      tokens[tag] = authenticator.issue({
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      });
    }
    await prisma.exchangeRate.create({
      data: { date: d(TODAY), currency: 'VES', usdRate: '36.5' },
    });
    clientId = (await makeClient(prisma)).id;
    projectId = (await makeProject(prisma)).id;
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await prisma.exchangeRate.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /dashboard', () => {
    it('refuses an anonymous request and rejects a bad query or a future period', async () => {
      await http().get('/api/v1/dashboard').expect(401);
      for (const query of [
        '?period=week',
        '?month=2026-13',
        '?month=x',
        '?month=2026-02',
        '?period=quarter&month=2026-04',
      ]) {
        const res = await get('owner', `/dashboard${query}`).expect(422);
        expect(res.body.error.code).toBe('VALIDATION');
      }
    });

    it('month: the hand-computed cards, strings and period bounds', async () => {
      await seedLedger();
      const res = await get('owner', '/dashboard').expect(200);
      expect(res.body).toMatchObject({
        month: '2026-01',
        period: 'month',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        currency: 'USD',
      });
      expect(cardsOf(res.body)).toEqual({
        COLLECTED_MONTH: ['400.00', '200.00', '100.00', null],
        BILLED_MONTH: ['900.00', '500.00', '80.00', null],
        RECEIVABLE: ['1000.00', '500.00', '100.00', '500.00'],
        EXPENSES_MONTH: ['120.00', '70.00', '71.43', null],
        RESULT_MONTH: ['280.00', '130.00', '115.38', null],
        ACCOUNTS_BALANCE: ['1100.00', null, null, null],
        MRR: ['150.00', '100.00', '50.00', null],
        ACTIVE_PROJECTS: ['3', null, null, null],
      });
      expect(res.body.incomeVsExpenses.periods).toHaveLength(12);
      expect(res.body.incomeVsExpenses.series[0].values.at(-1)).toBe('400.00');
    });

    it('quarter: a running quarter against the previous one (January looks back to Q4)', async () => {
      await seedLedger();
      const res = await get('owner', '/dashboard?period=quarter').expect(200);
      expect(res.body).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-03-31' });
      expect(cardsOf(res.body)).toEqual({
        COLLECTED_MONTH: ['400.00', '300.00', '33.33', null],
        BILLED_MONTH: ['900.00', '800.00', '12.50', null],
        RECEIVABLE: ['1000.00', '500.00', '100.00', '500.00'],
        EXPENSES_MONTH: ['120.00', '120.00', '0.00', null],
        RESULT_MONTH: ['280.00', '180.00', '55.56', null],
        ACCOUNTS_BALANCE: ['1100.00', null, null, null],
        MRR: ['150.00', '100.00', '50.00', null],
        ACTIVE_PROJECTS: ['3', null, null, null],
      });
      // an anchor in a later month of the running quarter is the same quarter
      const later = await get('owner', '/dashboard?period=quarter&month=2026-03').expect(200);
      expect(later.body.kpis).toEqual(res.body.kpis);
    });

    it('year: a running year against the previous one', async () => {
      await seedLedger();
      const res = await get('owner', '/dashboard?period=year&month=2026-01').expect(200);
      expect(res.body).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-12-31' });
      expect(cardsOf(res.body)).toMatchObject({
        COLLECTED_MONTH: ['400.00', '1300.00', '-69.23', null],
        BILLED_MONTH: ['900.00', '2800.00', '-67.86', null],
        EXPENSES_MONTH: ['120.00', '620.00', '-80.65', null],
        RESULT_MONTH: ['280.00', '680.00', '-58.82', null],
        RECEIVABLE: ['1000.00', '500.00', '100.00', '500.00'],
      });
    });

    it('a past month closes on its last day', async () => {
      await seedLedger();
      const res = await get('owner', '/dashboard?month=2025-12').expect(200);
      expect(cardsOf(res.body)).toMatchObject({
        COLLECTED_MONTH: ['200.00', '100.00', '100.00', null],
        RECEIVABLE: ['500.00', '200.00', '150.00', '200.00'],
        MRR: ['100.00', '130.00', '-23.08', null],
      });
    });

    it('C16: a new VES rate moves no stored figure, only the live account balance', async () => {
      await seedLedger();
      const ves = await makeInvoice(prisma, clientId);
      await prisma.invoice.update({
        where: { id: ves.id },
        data: {
          code: 'FAC-VES',
          currency: 'VES',
          usdRate: '36.5',
          balance: '365.00',
          dueDate: d('2026-01-10'),
          status: 'VENCIDA',
        },
      });
      const before = await get('owner', '/dashboard').expect(200);
      expect(before.body.invoicesDue[0]).toMatchObject({
        balance: '365.00',
        balanceUsd: '10.00',
        currency: 'VES',
        daysUntilDue: -5,
      });

      await prisma.exchangeRate.updateMany({ where: { currency: 'VES' }, data: { usdRate: '40' } });
      const after = await get('owner', '/dashboard').expect(200);
      expect(after.body.invoicesDue[0].balanceUsd).toBe('10.00');
      const stored = (b: { kpis: { id: string }[] }) =>
        b.kpis.filter((k) => k.id !== 'ACCOUNTS_BALANCE');
      expect(stored(after.body)).toEqual(stored(before.body));
      // §8.1's own exception: "Saldo total en cuentas" is valued at the latest rate: 1000 + 3650 / 40
      expect(cardsOf(after.body).ACCOUNTS_BALANCE).toEqual(['1091.25', null, null, null]);
    });

    it('lists the panels within the next 30 days with their references', async () => {
      const doc = await makeDocument(prisma);
      await prisma.document.update({
        where: { id: doc.id },
        data: { title: 'NDA', status: 'FIRMADO', expiresAt: d('2026-01-20') },
      });
      await prisma.billingInstallment.create({
        data: {
          projectId,
          kind: 'HITO',
          label: 'Hito 1',
          amount: '300',
          currency: 'USD',
          dueDate: d('2026-01-31'),
        },
      });
      await prisma.activityLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'CREATE',
          entityType: 'CLIENT',
          entityId: clientId,
          entityLabel: 'Kairos',
        },
      });
      const res = await get('owner', '/dashboard').expect(200);
      expect(res.body.documentsExpiring).toEqual([
        {
          document: { type: 'DOCUMENT', id: doc.id, code: doc.code, label: 'NDA' },
          expiresAt: '2026-01-20',
          daysLeft: 5,
        },
      ]);
      expect(res.body.installmentsToInvoice).toHaveLength(1);
      expect(res.body.installmentsToInvoice[0]).toMatchObject({
        amount: '300.00',
        dueDate: '2026-01-31',
        project: { id: projectId },
      });
      expect(res.body.recentActivity).toHaveLength(1);
      expect(res.body.recentActivity[0]).toMatchObject({ action: 'CREATE', actorName: null });
    });

    it.each(['member', 'viewer'] as const)(
      '%s: zeroed cards, no comparison, empty financial panels, no activity (DT-175)',
      async (role) => {
        await seedLedger();
        await makeInvoice(prisma, clientId);
        const doc = await makeDocument(prisma);
        await prisma.document.update({
          where: { id: doc.id },
          data: { status: 'FIRMADO', expiresAt: d('2026-01-20') },
        });
        const res = await get(role, '/dashboard').expect(200);
        const zero = ['0.00', null, null, null];
        expect(cardsOf(res.body)).toEqual({
          COLLECTED_MONTH: zero,
          BILLED_MONTH: zero,
          RECEIVABLE: zero,
          EXPENSES_MONTH: zero,
          RESULT_MONTH: zero,
          ACCOUNTS_BALANCE: zero,
          MRR: zero,
          ACTIVE_PROJECTS: ['3', null, null, null],
        });
        expect(
          res.body.incomeVsExpenses.series.flatMap((s: { values: string[] }) => s.values),
        ).toEqual(Array(24).fill('0.00'));
        expect(res.body.invoicesDue).toEqual([]);
        expect(res.body.installmentsToInvoice).toEqual([]);
        expect(res.body.upcomingRecurringExpenses).toEqual([]);
        expect(res.body.recentActivity).toEqual([]);
        expect(res.body.documentsExpiring).toHaveLength(1);
      },
    );
  });

  describe('GET /shell', () => {
    it('refuses an anonymous request', async () => {
      await http().get('/api/v1/shell').expect(401);
    });

    it('returns the caller, the VES chip and the bell counters', async () => {
      const inv = await makeInvoice(prisma, clientId);
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { status: 'VENCIDA', dueDate: d('2026-01-10'), balance: '50.00' },
      });
      const res = await get('owner', '/shell').expect(200);
      expect(res.body).toEqual({
        user: {
          id: expect.any(String),
          name: 'owner',
          email: 'owner@example.test',
          role: 'OWNER',
        },
        vesRate: { date: TODAY, usdRate: '36.5', source: 'MANUAL' },
        vesRateMissing: false,
        alerts: { total: 1, unread: 1, byType: { INVOICE_OVERDUE: 1 } },
      });
      const member = await get('member', '/shell').expect(200);
      expect(member.body.alerts).toEqual({ total: 0, unread: 0, byType: {} });
    });

    it('warns on a business day that only has an earlier rate', async () => {
      await prisma.exchangeRate.deleteMany();
      await prisma.exchangeRate.create({
        data: { date: d('2026-01-13'), currency: 'VES', usdRate: '35.9' },
      });
      const res = await get('viewer', '/shell').expect(200);
      expect(res.body).toMatchObject({
        vesRate: { date: '2026-01-13', usdRate: '35.9' },
        vesRateMissing: true,
      });
    });
  });

  describe('summaries', () => {
    it('client summary: stored metrics plus the rolling twelve months from facts', async () => {
      await prisma.clientMetrics.create({
        data: {
          clientId,
          invoicedUsd: '1000.00',
          collectedUsd: '600.00',
          receivableUsd: '400.00',
          overdueUsd: '150.00',
          creditUsd: '25.50',
          projectCount: 2,
        },
      });
      const collected = (date: string, amountUsd: string, forClient: string) => ({
        kind: 'COLLECTED' as const,
        date: d(date),
        amountUsd,
        clientId: forClient,
        sourceType: 'PAYMENT' as const,
        sourceId: `p-${amountUsd}`,
      });
      await prisma.financeFact.createMany({
        data: [
          collected('2025-01-14', '999.00', clientId),
          collected('2025-01-15', '100.10', clientId),
          collected('2025-12-01', '0.20', clientId),
          collected('2025-12-01', '77.00', 'other'),
        ],
      });
      for (const role of ['owner', 'admin'] as const) {
        const res = await get(role, `/clients/${clientId}/summary`).expect(200);
        expect(res.body).toEqual({
          clientId,
          totalInvoicedUsd: '1000.00',
          totalCollectedUsd: '600.00',
          receivableUsd: '400.00',
          overdueUsd: '150.00',
          creditBalanceUsd: '25.50',
          projectCount: 2,
          collectedLast12MonthsUsd: '100.30',
        });
      }
    });

    it('project summary: the §8.4.4 figures; "to invoice" only for a billing plan', async () => {
      await prisma.projectMetrics.create({
        data: {
          projectId,
          contractedUsd: '2000',
          invoicedUsd: '1000',
          collectedUsd: '700',
          toInvoiceUsd: '1000',
          receivableUsd: '300',
          expensesUsd: '490',
          marginUsd: '210',
          monthlyRecurringUsd: '50',
        },
      });
      const without = await get('owner', `/projects/${projectId}/summary`).expect(200);
      expect(without.body).toEqual({
        projectId,
        currency: 'USD',
        contractedValue: '2000.00',
        invoiced: '1000.00',
        collected: '700.00',
        toInvoice: null,
        receivable: '300.00',
        monthlyRecurring: '50.00',
        allocatedExpenses: '490.00',
        margin: '210.00',
        marginPercent: '30.00',
      });
      await prisma.billingPlan.create({
        data: { projectId, model: 'PRECIO_FIJO', currency: 'USD', contractedUsd: '2000' },
      });
      const fixed = await get('admin', `/projects/${projectId}/summary`).expect(200);
      expect(fixed.body.toInvoice).toBe('1000.00');
    });

    it('is FORBIDDEN without canSeeFinancials, NOT_FOUND for an unknown id, 401 anonymous', async () => {
      await http().get(`/api/v1/clients/${clientId}/summary`).expect(401);
      for (const path of [`/clients/${clientId}/summary`, `/projects/${projectId}/summary`]) {
        for (const role of ['member', 'viewer'] as const) {
          const res = await get(role, path).expect(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
      for (const path of ['/clients/nope/summary', '/projects/nope/summary']) {
        const res = await get('owner', path).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('an archived client or project is readable by the trash roles (C19)', async () => {
      await prisma.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });
      await prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
      await get('owner', `/clients/${clientId}/summary`).expect(200);
      await get('admin', `/projects/${projectId}/summary`).expect(200);
    });
  });
});
