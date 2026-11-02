import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { AlertsModule } from '../../../src/modules/intelligence/alerts.module';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import { addDays, parseDateOnly } from '../../../src/shared/domain/business-date';
import { makeAccount, makeClient, makeInvoice, makePayment } from '../../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { createTestApp } from '../../support/test-app';
import { NOW, TODAY } from './alerts-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const DAY = 86_400_000;
const d = (offset: number) => parseDateOnly(addDays(TODAY, offset));
const path = (key: string, action: string) => `/api/v1/alerts/${encodeURIComponent(key)}/${action}`;

describe('alerts (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const clock = new FixedClock(NOW);
  let app: NestExpressApplication;
  const tokens = { owner: '', admin: '', member: '', viewer: '' };
  type Role = keyof typeof tokens;

  const http = () => request(app.getHttpServer());
  const as = (role: Role) => `Bearer ${tokens[role]}`;
  const list = (role: Role, query = '') =>
    http().get(`/api/v1/alerts${query}`).set('Authorization', as(role));
  const keysOf = (body: { items: { alertKey: string }[] }) => body.items.map((i) => i.alertKey);

  let clientId = '';
  let projectId = '';

  beforeAll(async () => {
    app = await createTestApp({
      modules: [AlertsModule],
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
    // A VES rate for today keeps MISSING_RATE out unless a test removes it.
    await prisma.exchangeRate.create({ data: { date: d(0), currency: 'VES', usdRate: '36.5' } });
    clientId = (await makeClient(prisma)).id;
    projectId = (
      await prisma.project.create({ data: { code: 'PRY-1', name: 'Portal', summary: 's' } })
    ).id;
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  const invoice = async (
    offset: number,
    status: 'EMITIDA' | 'PARCIAL' | 'VENCIDA',
    balance = '116',
  ) => {
    const row = await makeInvoice(prisma, clientId);
    return prisma.invoice.update({
      where: { id: row.id },
      data: { dueDate: d(offset), status, balance },
    });
  };

  it('refuses an anonymous request and rejects a malformed query', async () => {
    await http().get('/api/v1/alerts').expect(401);
    for (const query of [
      '?limit=0',
      '?limit=201',
      '?limit=x',
      '?types=NOPE',
      '?types=INVOICE_OVERDUE&types=NOPE',
    ]) {
      const res = await list('owner', query).expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });

  it('lists an overdue invoice with its reference, balance, days and client (money as strings)', async () => {
    const inv = await invoice(-3, 'VENCIDA', '116.50');
    const res = await list('owner', '?types=INVOICE_OVERDUE').expect(200);
    expect(res.body).toEqual({
      total: 1,
      byType: { INVOICE_OVERDUE: 1 },
      unread: 1,
      readKeys: [],
      items: [
        {
          alertKey: `INVOICE_OVERDUE:${inv.id}`,
          type: 'INVOICE_OVERDUE',
          entity: { type: 'INVOICE', id: inv.id, code: inv.code, label: inv.invoiceNumber },
          date: addDays(TODAY, -3),
          days: -3,
          amount: { amount: '116.50', currency: 'USD' },
          context: expect.stringContaining('Trade'),
        },
      ],
    });
  });

  it('HU-10 CA4: a pending recurring installment alerts seven days before its billing day', async () => {
    const inst = await prisma.billingInstallment.create({
      data: {
        projectId,
        kind: 'RECURRENTE',
        label: 'Soporte mensual',
        amount: '150',
        currency: 'USD',
        dueDate: d(7),
        periodStart: d(7),
      },
    });
    const res = await list('owner', '?types=INSTALLMENT_TO_INVOICE').expect(200);
    expect(res.body.items).toEqual([
      {
        alertKey: `INSTALLMENT_TO_INVOICE:${inst.id}`,
        type: 'INSTALLMENT_TO_INVOICE',
        entity: { type: 'PROJECT', id: projectId, code: 'PRY-1', label: 'Portal' },
        date: addDays(TODAY, 7),
        days: 7,
        amount: { amount: '150.00', currency: 'USD' },
        context: 'Soporte mensual',
      },
    ]);
    await prisma.billingInstallment.update({
      where: { id: inst.id },
      data: { status: 'FACTURADA' },
    });
    expect((await list('owner', '?types=INSTALLMENT_TO_INVOICE').expect(200)).body.total).toBe(0);
  });

  it('HU-19 CA2: a document alerts at alertDaysBefore and not the day after; the default is 30', async () => {
    const doc = (code: string, offset: number, alertDaysBefore?: number) =>
      prisma.document.create({
        data: {
          code,
          title: code,
          typeId: 'dtyp_prd',
          status: 'FIRMADO',
          expiresAt: d(offset),
          ...(alertDaysBefore === undefined ? {} : { alertDaysBefore }),
        },
      });
    const at = await doc('at', 10, 10);
    await doc('after', 11, 10);
    const dflt = await doc('dflt', 30);
    await doc('dflt31', 31);
    const res = await list('member', '?types=DOCUMENT_EXPIRING').expect(200);
    expect(keysOf(res.body).sort()).toEqual(
      [`DOCUMENT_EXPIRING:${at.id}`, `DOCUMENT_EXPIRING:${dflt.id}`].sort(),
    );
    clock.advance(DAY); // one day later the 'after' document enters its window, 'at' has 9 days left
    const next = await list('member', '?types=DOCUMENT_EXPIRING').expect(200);
    expect(next.body.total).toBe(4);
  });

  it('each rule at its boundary, moved by the clock', async () => {
    const d7 = await invoice(7, 'EMITIDA');
    const d8 = await invoice(8, 'EMITIDA');
    const account = await makeAccount(prisma);
    const young = await makePayment(prisma, clientId, account.id, { date: d(-2) });
    const old = await makePayment(prisma, clientId, account.id, { date: d(-3) });
    await prisma.payment.updateMany({
      where: { id: { in: [young.id, old.id] } },
      data: { status: 'PENDIENTE_VERIFICACION' },
    });
    const c15 = await makePayment(prisma, clientId, account.id, { date: d(-15) });
    const c16 = await makePayment(prisma, clientId, account.id, { date: d(-16) });

    const res = await list('owner').expect(200);
    const keys = keysOf(res.body);
    expect(keys).toContain(`INVOICE_DUE_SOON:${d7.id}`);
    expect(keys).not.toContain(`INVOICE_DUE_SOON:${d8.id}`);
    expect(keys).toContain(`PAYMENT_PENDING_VERIFICATION:${old.id}`);
    expect(keys).not.toContain(`PAYMENT_PENDING_VERIFICATION:${young.id}`);
    expect(keys).toContain(`UNALLOCATED_CREDIT:${c16.id}`);
    expect(keys).not.toContain(`UNALLOCATED_CREDIT:${c15.id}`);

    clock.advance(DAY); // the 16th in Caracas
    const next = keysOf((await list('owner').expect(200)).body);
    expect(next).toContain(`INVOICE_DUE_SOON:${d8.id}`);
    expect(next).toContain(`PAYMENT_PENDING_VERIFICATION:${young.id}`);
    expect(next).toContain(`UNALLOCATED_CREDIT:${c15.id}`);
  });

  it('missing rate: a business day without a VES rate alerts the Owner and Admin, the weekend does not', async () => {
    await prisma.exchangeRate.deleteMany();
    const key = `MISSING_RATE:VES:${TODAY}`;
    expect(keysOf((await list('admin').expect(200)).body)).toContain(key);
    expect(keysOf((await list('owner').expect(200)).body)).toContain(key);
    clock.set('2026-01-17T15:00:00.000Z'); // Saturday
    expect((await list('admin').expect(200)).body.total).toBe(0);
  });

  it('Member and Viewer get no financial type and no error; documents stay', async () => {
    await invoice(-1, 'VENCIDA');
    await prisma.exchangeRate.deleteMany();
    await prisma.document.create({
      data: { code: 'doc', title: 'doc', typeId: 'dtyp_prd', status: 'FIRMADO', expiresAt: d(5) },
    });
    for (const role of ['member', 'viewer'] as const) {
      const res = await list(role).expect(200);
      expect(Object.keys(res.body.byType)).toEqual(['DOCUMENT_EXPIRING']);
      const asked = await list(role, '?types=INVOICE_OVERDUE&types=MISSING_RATE').expect(200);
      expect(asked.body).toEqual({ total: 0, byType: {}, items: [], unread: 0, readKeys: [] });
    }
    expect((await list('owner').expect(200)).body.byType).toMatchObject({
      INVOICE_OVERDUE: 1,
      MISSING_RATE: 1,
      DOCUMENT_EXPIRING: 1,
    });
  });

  it('caps items by limit but not the counters; the default is 50', async () => {
    for (let i = 0; i < 3; i++) await invoice(-1 - i, 'VENCIDA');
    const one = (await list('owner', '?types=INVOICE_OVERDUE&limit=1').expect(200)).body;
    expect(one).toMatchObject({ total: 3, unread: 3 });
    expect(one.items).toHaveLength(1);
    expect(one.items[0].days).toBe(-3); // most overdue first
  });

  describe('state', () => {
    let key = '';
    beforeEach(async () => {
      key = `INVOICE_OVERDUE:${(await invoice(-1, 'VENCIDA')).id}`;
    });
    const total = async (role: Role) =>
      (await list(role, '?types=INVOICE_OVERDUE').expect(200)).body.total as number;

    it('X3: a read-only row does not hide its alert; a read alert stays listed and leaves the counter', async () => {
      const res = await http()
        .post(path(key, 'read'))
        .set('Authorization', as('owner'))
        .expect(200);
      expect(res.body).toEqual({ alertKeys: [key] });
      await http().post(path(key, 'read')).set('Authorization', as('owner')).expect(200);
      const after = (await list('owner', '?types=INVOICE_OVERDUE').expect(200)).body;
      expect(after).toMatchObject({ total: 1, unread: 0, readKeys: [key] });
      expect(keysOf(after)).toEqual([key]);
      expect(await prisma.alertState.count()).toBe(1);
      expect((await list('admin', '?types=INVOICE_OVERDUE').expect(200)).body).toMatchObject({
        unread: 1,
        readKeys: [],
      });
    });

    it('batch read marks many keys and validates the batch', async () => {
      const other = `INVOICE_OVERDUE:${(await invoice(-2, 'VENCIDA')).id}`;
      const res = await http()
        .post('/api/v1/alerts/read')
        .set('Authorization', as('owner'))
        .send({ alertKeys: [key, other, key] })
        .expect(200);
      expect(res.body.alertKeys.sort()).toEqual([key, other].sort());
      expect((await list('owner', '?types=INVOICE_OVERDUE').expect(200)).body.unread).toBe(0);
      const many = Array.from({ length: 201 }, (_, i) => `INVOICE_OVERDUE:i${i}`);
      for (const alertKeys of [[], many, ['nope']]) {
        const bad = await http()
          .post('/api/v1/alerts/read')
          .set('Authorization', as('owner'))
          .send({ alertKeys })
          .expect(422);
        expect(bad.body.error.code).toBe('VALIDATION');
      }
    });

    it('dismiss hides for good and only for the caller; restore brings it back and keeps the read mark', async () => {
      await http().post(path(key, 'read')).set('Authorization', as('owner')).expect(200);
      const res = await http()
        .post(path(key, 'dismiss'))
        .set('Authorization', as('owner'))
        .expect(200);
      expect(res.body).toEqual({ alertKey: key, dismissedUntil: null, active: false });
      expect(await total('owner')).toBe(0);
      expect(await total('admin')).toBe(1);
      const row = await prisma.alertState.findFirstOrThrow();
      expect(row).toMatchObject({ dismissedUntil: null });
      expect(row.dismissedAt).not.toBeNull();

      const restored = await http()
        .post(path(key, 'restore'))
        .set('Authorization', as('owner'))
        .expect(200);
      expect(restored.body).toEqual({ alertKey: key, dismissedUntil: null, active: true });
      expect((await list('owner', '?types=INVOICE_OVERDUE').expect(200)).body).toMatchObject({
        total: 1,
        readKeys: [key],
      });
    });

    it('snooze hides until now + days and the alert returns after its date', async () => {
      const res = await http()
        .post(path(key, 'dismiss'))
        .set('Authorization', as('owner'))
        .send({ days: 2 })
        .expect(200);
      expect(res.body).toEqual({
        alertKey: key,
        dismissedUntil: new Date(clock.now().getTime() + 2 * DAY).toISOString(),
        active: false,
      });
      expect(await total('owner')).toBe(0);
      clock.advance(2 * DAY - 1);
      expect(await total('owner')).toBe(0);
      clock.advance(2);
      expect(await total('owner')).toBe(1);
      expect(await total('admin')).toBe(1);
    });

    it('rejects a bad snooze, a malformed key and an unknown type', async () => {
      for (const days of [0, 91, 1.5, 'x']) {
        const res = await http()
          .post(path(key, 'dismiss'))
          .set('Authorization', as('owner'))
          .send({ days })
          .expect(422);
        expect(res.body.error.code).toBe('VALIDATION');
      }
      for (const bad of ['nope', "INVOICE_OVERDUE:x'; DROP TABLE", 'UNKNOWN:abc']) {
        const res = await http()
          .post(path(bad, 'dismiss'))
          .set('Authorization', as('owner'))
          .expect(422);
        expect(res.body.error).toMatchObject({
          code: 'VALIDATION',
          fieldErrors: { alertKey: ['alerts.validation.alertKey'] },
        });
      }
      expect(await prisma.alertState.count()).toBe(0);
    });

    it('A8: a type the caller cannot see is NOT_FOUND on every write route and writes nothing', async () => {
      for (const action of ['read', 'dismiss', 'restore']) {
        const res = await http()
          .post(path(key, action))
          .set('Authorization', as('member'))
          .expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      await http()
        .post('/api/v1/alerts/read')
        .set('Authorization', as('viewer'))
        .send({ alertKeys: [key] })
        .expect(404);
      await http()
        .post(path(`MISSING_RATE:VES:${TODAY}`, 'dismiss'))
        .set('Authorization', as('viewer'))
        .expect(404);
      expect(await prisma.alertState.count()).toBe(0);
    });

    it('A8: the subject is not resolved; a vanished alert can still be dismissed', async () => {
      const res = await http()
        .post(path('INVOICE_OVERDUE:gone_long_ago', 'dismiss'))
        .set('Authorization', as('owner'))
        .send({})
        .expect(200);
      expect(res.body.active).toBe(false);
    });

    it('per-user state writes no activity (DT-79)', async () => {
      await http().post(path(key, 'read')).set('Authorization', as('owner')).expect(200);
      await http()
        .post(path(key, 'dismiss'))
        .set('Authorization', as('owner'))
        .send({ days: 3 })
        .expect(200);
      await http().post(path(key, 'restore')).set('Authorization', as('owner')).expect(200);
      expect(await prisma.activityLog.count()).toBe(0);
    });
  });
});
