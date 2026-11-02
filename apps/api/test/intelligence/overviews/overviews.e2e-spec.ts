import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { createOverviewsApp } from './overviews-app';
import { seedStudio } from './seed';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// Thursday 2026-10-15, 12:00 in Caracas.
const NOW = '2026-10-15T16:00:00.000Z';
const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
type Role = (typeof ROLES)[number];
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('module overviews (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const clock = new FixedClock(NOW);
  let app: NestExpressApplication;
  const tokens = {} as Record<Role, string>;
  const userIds = {} as Record<Role, string>;
  let studio: Awaited<ReturnType<typeof seedStudio>>;

  beforeAll(async () => {
    app = await createOverviewsApp(authenticator, clock);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    for (const role of ROLES) {
      const row = await prisma.user.create({
        data: { clerkId: `clerk_${role}`, email: `${role}@example.test`, name: role, role },
      });
      userIds[role] = row.id;
      const user: CurrentUser = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      tokens[role] = authenticator.issue(user);
    }
    studio = await seedStudio(prisma);
  });

  const get = (role: Role | null, path: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1${path}`);
    return role ? req.set('Authorization', `Bearer ${tokens[role]}`) : req;
  };
  const ok = async (role: Role, path: string): Promise<Body> =>
    (await get(role, path).expect(200)).body as Body;
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  it('answers 401 without a token on every overview route', async () => {
    for (const module of [
      'clients',
      'projects',
      'invoices',
      'payments',
      'expenses',
      'accounts',
      'documents',
      'activity',
    ]) {
      const res = await get(null, `/${module}/overview`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  describe('GET /clients/overview', () => {
    it('Owner: counts live clients, ranks by what was collected in 12 months and by overdue balance', async () => {
      // Registered ahead of GET /clients/:id (A1): a shadowed route would answer NOT_FOUND here.
      const body = await ok('OWNER', '/clients/overview');

      expect(body.countByStatus).toEqual({ PROSPECTO: 1, ACTIVO: 1, INACTIVO: 1 });
      expect(body.topByRevenue.map((r: Body) => [r.id, r.collectedLast12MonthsUsd])).toEqual([
        ['cli_mochima', '300.00'],
        ['cli_kairos', '240.10'],
      ]);
      expect(body.withOverdueBalance.map((r: Body) => [r.id, r.overdueUsd])).toEqual([
        ['cli_kairos', '120.00'],
        ['cli_mochima', '40.00'],
      ]);
      expect(ids(body.recentlyCreated)).toEqual(['cli_zeta', 'cli_mochima', 'cli_kairos']);
      const kairos = body.recentlyCreated.find((r: Body) => r.id === 'cli_kairos');
      expect(kairos).toMatchObject({ tradeName: 'Kairos', totalInvoicedUsd: '500.00' });
    });

    it.each(['MEMBER', 'VIEWER'] as const)(
      '%s: no client by money, in membership or order, and every row money null (X15)',
      async (role) => {
        const body = await ok(role, '/clients/overview');

        expect(body.countByStatus).toEqual({ PROSPECTO: 1, ACTIVO: 1, INACTIVO: 1 });
        expect(body.topByRevenue).toEqual([]);
        expect(body.withOverdueBalance).toEqual([]);
        // Kairos has the most money and is the oldest: the order is the creation date, never money.
        expect(ids(body.recentlyCreated)).toEqual(['cli_zeta', 'cli_mochima', 'cli_kairos']);
        for (const row of body.recentlyCreated) {
          expect(row.totalInvoicedUsd).toBeNull();
          expect(row.receivableUsd).toBeNull();
        }
        expect(JSON.stringify(body)).not.toContain('collectedLast12MonthsUsd');
        expect(JSON.stringify(body)).not.toContain('overdueUsd');
      },
    );
  });

  describe('GET /projects/overview', () => {
    it('Owner: counts, upcoming deliveries, no plan, top technologies and the most to invoice', async () => {
      const body = await ok('OWNER', '/projects/overview');

      expect(body.countByStatus).toMatchObject({
        EN_CURSO: 2,
        PAUSADO: 1,
        ENTREGADO: 1,
        PROPUESTA: 0,
      });
      // Running or paused, due today or later, soonest first; the archived one and the delivered one are out.
      expect(ids(body.upcomingDeliveries)).toEqual(['pb', 'pa']);
      expect(ids(body.withoutBillingPlan)).toEqual(['pa', 'pc', 'pd']);
      expect(body.topTechnologies).toEqual([
        { technology: expect.objectContaining({ id: studio.techId }), projectCount: 2 },
      ]);
      expect(body.highestToInvoice.map((r: Body) => [r.id, r.toInvoiceUsd])).toEqual([
        ['pa', '500.00'],
        ['pb', '90.50'],
      ]);
    });

    it.each(['MEMBER', 'VIEWER'] as const)(
      '%s: highestToInvoice is empty and the other rows carry money null (X15)',
      async (role) => {
        const body = await ok(role, '/projects/overview');

        expect(body.highestToInvoice).toEqual([]);
        expect(ids(body.upcomingDeliveries)).toEqual(['pb', 'pa']);
        for (const row of [...body.upcomingDeliveries, ...body.withoutBillingPlan]) {
          expect(row).toMatchObject({
            contractedValueUsd: null,
            invoicedUsd: null,
            collectedUsd: null,
            toInvoiceUsd: null,
          });
        }
      },
    );
  });

  describe('GET /invoices/overview', () => {
    it('Owner and Admin: billed against collected, aging, overdue and totals per currency', async () => {
      for (const role of ['OWNER', 'ADMIN'] as const) {
        const body = await ok(role, '/invoices/overview');

        expect(body.billedVsCollected.periods).toEqual([
          '2026-05',
          '2026-06',
          '2026-07',
          '2026-08',
          '2026-09',
          '2026-10',
        ]);
        expect(body.billedVsCollected.series).toEqual([
          { id: 'billed', values: ['70.00', '0.00', '0.00', '0.00', '100.00', '0.00'] },
          { id: 'collected', values: ['0.00', '0.00', '0.00', '5000.00', '200.10', '40.00'] },
        ]);
        expect(body.aging).toEqual({
          d0_30: '60.00',
          d31_60: '0.00',
          d61_90: '0.00',
          d90plus: '70.00',
        });
        // The draft and the voided invoice (999 each) are not in the figures.
        expect(body.overdueCount).toBe(2);
        expect(body.totalsByCurrency).toEqual([
          { currency: 'USD', total: '170.00', balance: '130.00', overdue: '130.00' },
        ]);
      }
    });

    it.each(['MEMBER', 'VIEWER'] as const)('%s gets FORBIDDEN (DT-175)', async (role) => {
      const res = await get(role, '/invoices/overview').expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /payments/overview', () => {
    it('Owner: collected per month from the allocations, breakdowns and queues', async () => {
      const body = await ok('OWNER', '/payments/overview');

      expect(body.collectedByMonth).toHaveLength(12);
      expect(body.collectedByMonth[0]).toEqual({ period: '2025-11', value: '300.00' });
      expect(body.collectedByMonth.at(-1)).toEqual({ period: '2026-10', value: '40.00' });
      const month = (period: string) =>
        body.collectedByMonth.find((p: Body) => p.period === period).value;
      expect(month('2026-09')).toBe('200.10');
      // Facts outlive an archived client: its payment is still money collected that month.
      expect(month('2026-08')).toBe('5000.00');
      expect(body.byMethod).toEqual([
        { key: studio.methodB.code, label: studio.methodB.name, value: '300.00' },
        { key: studio.methodA.code, label: studio.methodA.name, value: '240.10' },
      ]);
      expect(body.byAccount.map((r: Body) => r.value)).toEqual(['300.00', '240.10']);
      expect(body.pendingVerificationCount).toBe(1);
      expect(body.unallocatedCount).toBe(1);
      expect(body.unallocatedTotalUsd).toBe('97.00');
    });

    it.each(['MEMBER', 'VIEWER'] as const)('%s gets FORBIDDEN (DT-175)', async (role) => {
      await get(role, '/payments/overview').expect(403);
    });
  });

  describe('GET /expenses/overview', () => {
    it('Owner: spend by root category and month, committed monthly and the upcoming pending ones', async () => {
      const body = await ok('ADMIN', '/expenses/overview');

      expect(body.byMonthAndCategory.periods).toEqual([
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
      ]);
      const byId = new Map(
        body.byMonthAndCategory.series.map((s: Body) => [s.id, s.values] as const),
      );
      expect(byId.get(studio.rootA.id)).toEqual(['1.10', '0.00', '0.00', '0.00', '0.00', '0.20']);
      expect(byId.get(studio.rootB.id)).toEqual(['0.00', '0.00', '0.00', '0.00', '2.38', '0.00']);
      expect(new Map(body.byCategory.map((c: Body) => [c.key, c.value]))).toEqual(
        new Map([
          [studio.rootA.id, '1.30'],
          [studio.rootB.id, '2.38'],
        ]),
      );
      expect(body.committedMonthly).toBe('30.30');
      expect(body.upcoming.map((e: Body) => e.code)).toEqual(['GAS-late', 'GAS-next', 'GAS-far']);
      expect(body.upcoming[0].overdue).toBe(true);
    });

    it.each(['MEMBER', 'VIEWER'] as const)('%s gets FORBIDDEN (DT-175)', async (role) => {
      await get(role, '/expenses/overview').expect(403);
    });
  });

  describe('GET /accounts/overview', () => {
    it('Owner: a card per account and the USD total of the active ones', async () => {
      const body = await ok('OWNER', '/accounts/overview');

      const named = new Map(body.accounts.map((a: Body) => [a.name, a] as const));
      expect(named.get('Caja')).toMatchObject({
        balance: '100.10',
        balanceUsd: '100.10',
        active: true,
      });
      expect(named.get('Cerrada')).toMatchObject({ active: false });
      expect(body.accounts).toHaveLength(5);
      expect(body.totalBalanceUsd).toBe('100.30');
    });

    it.each(['MEMBER', 'VIEWER'] as const)('%s gets FORBIDDEN (DT-175)', async (role) => {
      await get(role, '/accounts/overview').expect(403);
    });
  });

  describe('GET /documents/overview', () => {
    it.each(ROLES)(
      '%s: counts by category and status, expiry windows, recent and stale drafts',
      async (role) => {
        const body = await ok(role, '/documents/overview');

        const category = body.byCategoryAndStatus.find(
          (c: Body) => c.category.id === studio.documentCategoryId,
        );
        // The archived document (FIRMADO, expiring) is in no count.
        expect(category.countByStatus).toEqual({ FIRMADO: 1, APROBADO: 2, BORRADOR: 2 });
        expect(body.expiringCounts).toEqual({ days30: 1, days60: 2, days90: 3 });
        expect(ids(body.expiringSoon)).toEqual(['da', 'db', 'dc']);
        expect(ids(body.recent)).toEqual(['de', 'dc', 'db', 'da', 'dd']);
        expect(ids(body.staleDrafts)).toEqual(['dd']);
      },
    );
  });

  describe('GET /activity/overview', () => {
    beforeEach(async () => {
      const log = (data: { createdAt: string; actorId?: string; action: 'CREATE' | 'UPDATE' }) =>
        prisma.activityLog.create({
          data: {
            actorType: data.actorId ? 'USER' : 'SYSTEM',
            actorId: data.actorId ?? null,
            action: data.action,
            entityType: 'CLIENT',
            entityId: 'cli_kairos',
            entityLabel: 'Kairos',
            createdAt: new Date(data.createdAt),
          },
        });
      await log({ createdAt: '2026-10-15T10:00:00Z', actorId: userIds.OWNER, action: 'CREATE' });
      await log({ createdAt: '2026-10-14T10:00:00Z', actorId: userIds.OWNER, action: 'UPDATE' });
      await log({ createdAt: '2026-10-15T11:00:00Z', action: 'UPDATE' });
    });

    it('Owner and Admin: total, today and users in one call, under the GET /activity filter', async () => {
      for (const role of ['OWNER', 'ADMIN'] as const) {
        expect(await ok(role, '/activity/overview')).toEqual({ total: 3, today: 2, users: 2 });
      }
      // today ignores the filter; users is the filter restricted to users.
      expect(await ok('OWNER', '/activity/overview?action=UPDATE')).toEqual({
        total: 2,
        today: 2,
        users: 1,
      });
      expect(await ok('OWNER', '/activity/overview?from=2026-10-15&to=2026-10-15')).toEqual({
        total: 2,
        today: 2,
        users: 1,
      });
    });

    it('rejects the filters GET /activity rejects', async () => {
      const res = await get('OWNER', '/activity/overview?from=nope').expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it.each(['MEMBER', 'VIEWER'] as const)('%s gets FORBIDDEN', async (role) => {
      await get(role, '/activity/overview').expect(403);
    });
  });
});
