import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { ReportsModule } from '../../../src/modules/intelligence/reports.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { createTestApp } from '../../support/test-app';
import { NOW } from './reports-world';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const INVOICES = 5_000;
const RUNS = 5;
const admin = createTestPrisma();

const SLUGS = [
  'collected-by-month',
  'billed-vs-collected',
  'revenue-by-client',
  'revenue-by-project',
  'receivables-aging',
  'expenses-by-month-category',
  'net-result-monthly',
  'account-flow',
  'collections-by-method',
  'taxes-registered',
];

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
  ] ?? 0;

/**
 * Response time of the reports at 5,000 invoices over 24 months (DT-102: the monthly rollup stays deferred).
 * The facts are written directly in bulk, in the shape the projector leaves: BILLED, IVA and, for most
 * invoices, COLLECTED, plus withholdings and paid expenses.
 */
describe('reports at 5,000 invoices (performance)', () => {
  let app: NestExpressApplication;
  let token = '';
  const timings: Record<string, number[]> = {};

  beforeAll(async () => {
    await truncateBusinessTables(admin);
    await admin.$executeRawUnsafe(`
      INSERT INTO "Client" ("id","code","kind","tradeName","legalName","taxId","country","address","phone","updatedAt")
      SELECT 'pc'||i, 'PC-'||i, 'EMPRESA', 'Client '||i, 'Legal '||i, 'J-'||i, 'VE', 'x', '1', now()
      FROM generate_series(1, 300) i`);
    await admin.$executeRawUnsafe(`
      INSERT INTO "Project" ("id","code","name","summary","updatedAt")
      SELECT 'pp'||i, 'PP-'||i, 'Project '||i, 's', now() FROM generate_series(1, 120) i`);
    await admin.$executeRawUnsafe(`
      INSERT INTO "ProjectClient" ("projectId","clientId")
      SELECT 'pp'||i, 'pc'||(1 + (i * 7) % 300) FROM generate_series(1, 120) i`);
    await admin.$executeRawUnsafe(`
      INSERT INTO "Account" ("id","name","type","currency","openingDate","updatedAt")
      VALUES ('pacc','Main','BANCO_INTERNACIONAL','USD','2025-01-01', now())`);
    await admin.$executeRawUnsafe(`
      INSERT INTO "Invoice" ("id","code","clientId","invoiceNumber","issueDate","dueDate","currency","usdRate",
        "subtotal","taxBase","ivaAmount","total","receivable","totalUsd","receivableUsd","balance","updatedAt")
      SELECT 'pi'||i, 'PI-'||i, 'pc'||(1 + i % 300), 'N-'||i,
             date '2025-01-01' + (i % 660), date '2025-01-01' + (i % 660) + 30, 'USD', 1,
             100 + i % 900, 100 + i % 900, round((100 + i % 900) * 0.16, 2),
             round((100 + i % 900) * 1.16, 2), round((100 + i % 900) * 1.16, 2),
             round((100 + i % 900) * 1.16, 2), round((100 + i % 900) * 1.16, 2),
             round((100 + i % 900) * 1.16, 2), now()
      FROM generate_series(1, ${INVOICES}) i`);
    await admin.$executeRawUnsafe(`
      INSERT INTO "InvoiceTaxLine" ("id","invoiceId","ivaRate","taxBase","ivaAmount")
      SELECT 'ptl'||i, 'pi'||i, 16, 100 + i % 900, round((100 + i % 900) * 0.16, 2)
      FROM generate_series(1, ${INVOICES}) i`);
    const fact = (kind: string, where: string, extra: string, amount: string, date: string) => `
      INSERT INTO "FinanceFact" ("id","kind","date","amountUsd","clientId","projectId","accountId","categoryId",
        "invoiceId","ivaRate","dueDate","sourceType","sourceId")
      SELECT '${kind}'||i, '${kind}'::"FinanceFactKind", ${date}, ${amount}, ${extra}
      FROM generate_series(1, ${INVOICES}) i ${where}`;
    const issued = `date '2025-01-01' + (i % 660)`;
    const total = `round((100 + i % 900) * 1.16, 2)`;
    await admin.$executeRawUnsafe(
      fact(
        'BILLED',
        '',
        `'pc'||(1 + i % 300), 'pp'||(1 + i % 120), NULL, NULL, 'pi'||i, NULL, ${issued} + 30, 'INVOICE', 'pi'||i`,
        total,
        issued,
      ),
    );
    await admin.$executeRawUnsafe(
      fact(
        'IVA',
        '',
        `'pc'||(1 + i % 300), NULL, NULL, NULL, 'pi'||i, 16, NULL, 'INVOICE', 'pi'||i`,
        `round((100 + i % 900) * 0.16, 2)`,
        issued,
      ),
    );
    await admin.$executeRawUnsafe(
      fact(
        'WITHHELD_IVA',
        'WHERE i % 5 = 0',
        `'pc'||(1 + i % 300), NULL, NULL, NULL, 'pi'||i, NULL, NULL, 'INVOICE', 'pi'||i`,
        `round((100 + i % 900) * 0.04, 2)`,
        issued,
      ),
    );
    await admin.$executeRawUnsafe(
      fact(
        'COLLECTED',
        'WHERE i % 10 < 7',
        `'pc'||(1 + i % 300), 'pp'||(1 + i % 120), 'pacc', NULL, 'pi'||i, NULL, NULL, 'PAYMENT', 'pay'||i`,
        total,
        `${issued} + 20`,
      ),
    );
    await admin.$executeRawUnsafe(`
      INSERT INTO "FinanceFact" ("id","kind","date","amountUsd","projectId","accountId","categoryId","sourceType","sourceId")
      SELECT 'EXP'||i, 'EXPENSE_PAID', date '2025-01-01' + (i % 660), 10 + i % 200,
             'pp'||(1 + i % 120), 'pacc', 'ecat_hosting', 'EXPENSE', 'exp'||i
      FROM generate_series(1, 1000) i`);
    await admin.$executeRawUnsafe(`ANALYZE`);

    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [ReportsModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: CLOCK, useValue: new FixedClock(NOW) },
      ],
    });
    const row = await admin.user.create({
      data: { clerkId: 'clerk_perf_owner', email: 'owner@perf.test', name: 'Owner', role: 'OWNER' },
    });
    const user: CurrentUser = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'OWNER',
      email: row.email,
      name: row.name,
    };
    token = authenticator.issue(user);
  });
  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(admin);
    await admin.$disconnect();
  });

  async function measure(path: string): Promise<number[]> {
    const auth = { Authorization: `Bearer ${token}` };
    const warm = await request(app.getHttpServer()).get(`/api/v1${path}`).set(auth);
    expect(warm.status, `${path}: ${JSON.stringify(warm.body).slice(0, 200)}`).toBe(200);
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      const res = await request(app.getHttpServer()).get(`/api/v1${path}`).set(auth);
      runs.push(performance.now() - started);
      expect(res.status).toBe(200);
    }
    return runs;
  }

  it('seeded the volume it claims', async () => {
    const rows = await admin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Invoice"`;
    expect(Number(rows[0]?.n)).toBe(INVOICES);
  });

  it('answers the 18 KPIs in one call, fast enough for a page', async () => {
    timings.kpis = await measure('/reports/kpis?preset=LAST_12_MONTHS');
    expect(percentile(timings.kpis, 0.5)).toBeLessThan(2_000);
  });

  it.each(SLUGS)('answers %s', async (slug) => {
    timings[slug] = await measure(`/reports/${slug}?preset=LAST_12_MONTHS`);
    expect(percentile(timings[slug], 0.5)).toBeLessThan(2_000);
  });

  it('reports the response times', () => {
    const lines = Object.entries(timings).map(
      ([name, runs]) =>
        `${name.padEnd(30)} p50 ${percentile(runs, 0.5).toFixed(0).padStart(5)} ms   max ${Math.max(
          ...runs,
        )
          .toFixed(0)
          .padStart(5)} ms`,
    );
    console.info(
      `\nReports at ${INVOICES} invoices (LAST_12_MONTHS, ${RUNS} runs after a warm-up)\n${lines.join('\n')}`,
    );
    expect(lines.length).toBeGreaterThan(0);
  });
});
