import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runReindexAll } from '../scripts/reindex-all';
import { GenerateRecurringInstallments } from '../src/modules/finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { GenerateRecurringExpenses } from '../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { MarkOverdueInvoices } from '../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { MarkExpiredDocuments } from '../src/modules/documents/application/use-cases/records/mark-expired-documents.use-case';
import { MarkExpiredShareLinks } from '../src/modules/documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { MatrixAuthorization } from '../src/modules/identity/infrastructure/matrix-authorization';
import { DailyMaintenance } from '../src/modules/jobs/application/daily-maintenance';
import { JobRunner } from '../src/modules/jobs/application/job-runner';
import type { CurrentUser } from '../src/shared/application/current-user';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  UNIT_OF_WORK,
} from '../src/shared/application/ports/tokens';
import type { ActivityLogPort } from '../src/shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../src/shared/application/ports/unit-of-work.port';
import type { UserRole } from '../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from './support/db';
import { FakeAuthenticator } from './support/fakes/fake-authenticator';
import { FixedClock } from './support/fakes/fixed-clock';
import { createTestApp } from './support/test-app';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const V1 = '/api/v1';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 11:00 in Caracas on 2026-10-29: the invoice below fell due the day before (2026-10-28). */
const NOW = '2026-10-29T15:00:00.000Z';
/** The UTF-8 byte order mark every export starts with (written as a code point, not a literal). */
const BOM = String.fromCharCode(0xfeff);
const CREATED_AT = '2026-10-27T15:00:00.000Z';

/**
 * BE-5 intelligence flow over the full `AppModule` (package 6.1): the real `MatrixAuthorization` and route
 * guard, a fake identity provider and a fixed clock. The API process has no `JobsModule` (DT-169), so
 * `DailyMaintenance` is assembled in the spec from the steps `AppModule` exports and the real `JobRunner`
 * (the `JobsModule` factory, without BullMQ); it runs the five real `SYSTEM` use cases against the database.
 * No Redis, no queue and no schedule are involved here (those are proven in `test/jobs`).
 */
describe('BE-5 flows (full app)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const clock = new FixedClock(NOW);
  const tokens = {} as Record<UserRole, string>;
  const users = {} as Record<UserRole, CurrentUser>;
  const stepFailures: unknown[] = [];
  let app: NestExpressApplication;
  let daily: DailyMaintenance;

  beforeAll(async () => {
    app = await createTestApp({
      authenticator,
      probes: false,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: CLOCK, useValue: clock },
      ],
    });
    const runner = new JobRunner(
      app.get<UnitOfWorkPort>(UNIT_OF_WORK),
      app.get<ActivityLogPort>(ACTIVITY_LOG),
      { stepFailed: ({ step, error }) => stepFailures.push({ step, error }) },
    );
    const pick = <T>(type: new (...args: never[]) => T): T => app.get(type, { strict: false });
    daily = new DailyMaintenance(runner, {
      markOverdueInvoices: pick(MarkOverdueInvoices),
      markExpiredDocuments: pick(MarkExpiredDocuments),
      generateRecurringInstallments: pick(GenerateRecurringInstallments),
      generateRecurringExpenses: pick(GenerateRecurringExpenses),
      markExpiredShareLinks: pick(MarkExpiredShareLinks),
    });
  });

  beforeEach(async () => {
    stepFailures.length = 0;
    clock.set(NOW);
    await truncateBusinessTables(prisma);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `user_be5_${role.toLowerCase()}`,
          email: `be5-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      users[role] = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      tokens[role] = authenticator.issue(users[role]);
    }
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  const call = (method: 'get' | 'post' | 'patch', role: UserRole, path: string) =>
    request(app.getHttpServer())
      [method](`${V1}${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`);
  const get = (path: string, role: UserRole = 'OWNER') => call('get', role, path);
  const post = (path: string, body: object = {}, role: UserRole = 'OWNER') =>
    call('post', role, path).send(body);
  const patch = (path: string, body: object, role: UserRole = 'OWNER') =>
    call('patch', role, path).send(body);
  const kpi = (body: Body, id: string): Body => {
    const found = (body.kpis as Body[]).find((card) => card.id === id);
    if (!found) throw new Error(`KPI ${id} is not on the dashboard`);
    return found;
  };

  it('overdue -> alerts and dashboard -> search -> graph -> rename (no job) -> reindex finds nothing -> CSV -> dismiss', async () => {
    // The invoice is created two days before the job, while it is not yet due (one created past its due date
    // is born VENCIDA), then the clock moves to the day after its due date.
    clock.set(CREATED_AT);
    // Setup through the API: client, project, an invoice of 1000.00 + 16 % IVA = 1160.00 USD due on 2026-10-28.
    const clientFields = {
      kind: 'EMPRESA',
      tradeName: 'Nube Austral',
      legalName: 'Nube Austral C.A.',
      taxId: 'J-40111222-3',
      country: 'VE',
      address: 'Av. Principal, Caracas',
      phone: '+584121234567',
    };
    const client = (await post('/clients', clientFields, 'ADMIN').expect(201)).body as Body;
    const project = (
      await post(
        '/projects',
        { name: 'Sitio web', summary: 'Sitio institucional', clients: [{ clientId: client.id }] },
        'ADMIN',
      ).expect(201)
    ).body as Body;
    const invoice = (
      await post('/invoices', {
        clientId: client.id,
        invoiceNumber: 'F-5001',
        issueDate: '2026-10-14',
        dueDate: '2026-10-28',
        currency: 'USD',
        usdRate: '1',
        lines: [
          {
            description: 'Desarrollo',
            projectId: project.id,
            unitPrice: '1000.00',
            ivaRate: '16',
          },
        ],
      }).expect(201)
    ).body as Body;
    expect(invoice.status).toBe('EMITIDA');
    expect(invoice.totals.total).toBe('1160.00');
    const invoiceCode = invoice.code as string;

    // Before the job the invoice is only due soon: no overdue alert, nothing overdue on the dashboard.
    // (`MISSING_RATE` is there too: the test database has no VES rate for the day.)
    expect(
      ((await get('/alerts').expect(200)).body.items as Body[]).map((item) => item.type).sort(),
    ).toEqual(['INVOICE_DUE_SOON', 'MISSING_RATE']);
    const before = (await get('/dashboard').expect(200)).body as Body;
    expect(kpi(before, 'RECEIVABLE').value).toBe('1160.00');
    expect(kpi(before, 'RECEIVABLE').secondaryValue).toBe('0.00');
    expect(
      (
        await prisma.clientMetrics.findUniqueOrThrow({ where: { clientId: client.id } })
      ).overdueUsd.toFixed(2),
    ).toBe('0.00');

    clock.set(NOW);
    // 1. DailyMaintenance (the real five steps) marks it VENCIDA.
    const run = await daily.execute();
    expect(stepFailures).toEqual([]);
    expect(run.steps.map((s) => `${s.name}:${s.status}`)).toEqual([
      'mark-overdue-invoices:ok',
      'mark-expired-documents:ok',
      'generate-recurring-installments:ok',
      'generate-recurring-expenses:ok',
      'mark-expired-share-links:ok',
    ]);
    expect(run.steps[0]?.counts.updated).toBe(1);
    expect((await get(`/invoices/${invoice.id}`).expect(200)).body.status).toBe('VENCIDA');
    expect(
      (
        await prisma.clientMetrics.findUniqueOrThrow({ where: { clientId: client.id } })
      ).overdueUsd.toFixed(2),
    ).toBe('1160.00');

    // 2. The alert is in /shell and /alerts, and the dashboard card moved, in month and in quarter.
    const shell = (await get('/shell').expect(200)).body as Body;
    expect(shell.alerts.total).toBe(2);
    expect(shell.alerts.unread).toBe(2);
    expect(shell.alerts.byType).toEqual({ INVOICE_OVERDUE: 1, MISSING_RATE: 1 });
    const alerts = (await get('/alerts').expect(200)).body as Body;
    expect(alerts.total).toBe(2);
    const alert = (alerts.items as Body[]).find((a) => a.type === 'INVOICE_OVERDUE') as Body;
    expect(alert).toBeDefined();
    expect(alert.entity).toMatchObject({ type: 'INVOICE', id: invoice.id });
    expect(alert.amount).toEqual({ amount: '1160.00', currency: 'USD' });
    expect(alert.days).toBe(-1);
    for (const period of ['month', 'quarter']) {
      const dashboard = (await get(`/dashboard?period=${period}&month=2026-10`).expect(200))
        .body as Body;
      expect(dashboard.period).toBe(period);
      expect(kpi(dashboard, 'RECEIVABLE').value).toBe('1160.00');
      expect(kpi(dashboard, 'RECEIVABLE').secondaryValue).toBe('1160.00');
      expect((dashboard.invoicesDue as Body[])[0]?.daysUntilDue).toBe(-1);
    }

    // 3. Search by code goes to the invoice.
    const found = (await get(`/search?q=${encodeURIComponent(invoiceCode)}`).expect(200))
      .body as Body;
    const invoiceGroup = (found.groups as Body[]).find((g) => g.entityType === 'INVOICE');
    expect((invoiceGroup?.items as Body[]).map((item) => item.entityId)).toContain(invoice.id);

    // 4. The graph shows it under the client.
    const graph = (await get(`/graph/CLIENT/${client.id}?depth=1`).expect(200)).body as Body;
    const invoiceNode = (graph.nodes as Body[]).find((n) => n.entityId === invoice.id);
    expect(invoiceNode?.type).toBe('INVOICE');
    expect(
      (graph.edges as Body[]).some(
        (e) =>
          [e.source, e.target].includes(`CLIENT:${client.id}`) &&
          [e.source, e.target].includes(`INVOICE:${invoice.id}`),
      ),
    ).toBe(true);

    // 5. The client is renamed; list `q` by the new name finds the invoice in the same request sequence.
    expect((await get('/invoices?q=Orion')).body.items).toEqual([]);
    await patch(
      `/clients/${client.id}`,
      { ...clientFields, tradeName: 'Orion Digital' },
      'ADMIN',
    ).expect(200);
    const byNewName = (await get('/invoices?q=Orion').expect(200)).body as Body;
    expect((byNewName.items as Body[]).map((row) => row.id)).toEqual([invoice.id]);
    expect((await get('/invoices?q=Austral').expect(200)).body.items as Body[]).toEqual([]);

    // 6. `scripts/reindex-all` has nothing to change. Negative control: a stale entry is repaired once.
    const clean = await runReindexAll(process.env.DATABASE_URL);
    const dirty = (types: typeof clean) =>
      Object.values(types).reduce(
        (sum, r) => sum + (r?.created ?? 0) + (r?.updated ?? 0) + (r?.removed ?? 0),
        0,
      );
    expect(dirty(clean)).toBe(0);
    expect(clean.INVOICE?.unchanged).toBeGreaterThanOrEqual(1);
    await prisma.searchEntry.updateMany({
      where: { entityType: 'INVOICE', entityId: invoice.id },
      data: { title: 'stale title' },
    });
    expect(dirty(await runReindexAll(process.env.DATABASE_URL))).toBe(1);
    expect(dirty(await runReindexAll(process.env.DATABASE_URL))).toBe(0);

    // 7. CSV of invoices, with the headers the caller sent, and the EXPORT entry.
    const csv = await post('/exports/INVOICE', {
      query: { filters: {} },
      columns: [
        { id: 'code', label: 'Código' },
        { id: 'client', label: 'Cliente' },
        { id: 'total', label: 'Total' },
        { id: 'status', label: 'Estado' },
      ],
    }).expect(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['x-export-row-count']).toBe('1');
    expect(csv.headers['x-export-truncated']).toBe('false');
    const text = csv.text.replace(BOM, '');
    expect(csv.text.startsWith(BOM)).toBe(true);
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Código,Cliente,Total,Estado');
    expect(lines[1]).toContain(invoiceCode);
    expect(lines[1]).toContain('Orion Digital');
    expect(lines[1]).toContain('VENCIDA');
    expect(await prisma.activityLog.count({ where: { action: 'EXPORT' } })).toBe(1);

    // 8. Dismissing hides the alert for that user only.
    const key = encodeURIComponent(alert.alertKey as string);
    await post(`/alerts/${key}/dismiss`, {}, 'OWNER').expect(200);
    const keysOf = async (role: UserRole) =>
      ((await get('/alerts', role).expect(200)).body.items as Body[]).map((a) => a.alertKey);
    expect(await keysOf('OWNER')).not.toContain(alert.alertKey);
    expect((await get('/shell', 'OWNER').expect(200)).body.alerts.total).toBe(1);
    expect(await keysOf('ADMIN')).toContain(alert.alertKey);
    expect((await get('/shell', 'ADMIN').expect(200)).body.alerts.total).toBe(2);
    expect(await prisma.alertState.count({ where: { userId: users.OWNER.userId } })).toBe(1);
    expect(await prisma.alertState.count({ where: { userId: users.ADMIN.userId } })).toBe(0);
  });

  it('exposes the export headers to the FE origin only (CORS, choice 3)', async () => {
    const exportFrom = (origin: string) =>
      post('/exports/CLIENT', { columns: [{ id: 'code', label: 'Código' }] })
        .set('Origin', origin)
        .expect(200);
    const allowed = await exportFrom('http://localhost:3001');
    const exposed = String(allowed.headers['access-control-expose-headers'])
      .split(',')
      .map((name) => name.trim().toLowerCase());
    expect(exposed).toEqual(
      expect.arrayContaining(['content-disposition', 'x-export-row-count', 'x-export-truncated']),
    );
    expect(allowed.headers['x-export-row-count']).toBe('0');
    const foreign = await exportFrom('https://evil.example.test');
    expect(foreign.headers['access-control-expose-headers']).toBeUndefined();
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });
});
