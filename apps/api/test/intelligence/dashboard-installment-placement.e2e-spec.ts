import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import { AlertsModule } from '../../src/modules/intelligence/alerts.module';
import { DashboardModule } from '../../src/modules/intelligence/dashboard.module';
import { AUTHORIZATION, CLOCK } from '../../src/shared/application/ports/tokens';
import { addDays, parseDateOnly } from '../../src/shared/domain/business-date';
import { makeProject } from '../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { FixedClock } from '../support/fakes/fixed-clock';
import { createTestApp } from '../support/test-app';
import { NOW, TODAY } from './dashboard/dashboard-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * HU-10 CA4 (DT-181 7a): the `INSTALLMENT_TO_INVOICE` alert lands in the dashboard panel it belongs to
 * ("installments to invoice", the mock's placement) for the Owner and is absent for the Member, through the
 * real `GET /dashboard` and `GET /alerts` read paths.
 */
describe('HU-10 CA4: dashboard placement of INSTALLMENT_TO_INVOICE (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const clock = new FixedClock(NOW);
  let app: NestExpressApplication;
  const tokens = { owner: '', member: '' };
  type Role = keyof typeof tokens;
  const get = (role: Role, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`);
  let installmentId = '';

  beforeAll(async () => {
    app = await createTestApp({
      modules: [DashboardModule, AlertsModule],
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
    for (const [tag, role] of [
      ['owner', 'OWNER'],
      ['member', 'MEMBER'],
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
    const projectId = (await makeProject(prisma)).id;
    installmentId = (
      await prisma.billingInstallment.create({
        data: {
          projectId,
          kind: 'RECURRENTE',
          label: 'Soporte mensual',
          amount: '150',
          currency: 'USD',
          dueDate: parseDateOnly(addDays(TODAY, 7)),
          periodStart: parseDateOnly(addDays(TODAY, 7)),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  it('the Owner sees the alert and the same installment in the dashboard panel', async () => {
    const alerts = await get('owner', '/alerts?types=INSTALLMENT_TO_INVOICE').expect(200);
    expect(alerts.body.items.map((i: { alertKey: string }) => i.alertKey)).toEqual([
      `INSTALLMENT_TO_INVOICE:${installmentId}`,
    ]);
    const dashboard = await get('owner', '/dashboard').expect(200);
    expect(dashboard.body.installmentsToInvoice).toHaveLength(1);
    expect(dashboard.body.installmentsToInvoice[0]).toMatchObject({
      installment: { id: installmentId },
      amount: '150.00',
      dueDate: addDays(TODAY, 7),
    });
  });

  it('the Member gets neither the alert nor the panel row', async () => {
    const alerts = await get('member', '/alerts?types=INSTALLMENT_TO_INVOICE').expect(200);
    expect(alerts.body.items).toEqual([]);
    const dashboard = await get('member', '/dashboard').expect(200);
    expect(dashboard.body.installmentsToInvoice).toEqual([]);
  });
});
