import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpensesModule } from '../../../src/modules/finance/expenses.module';
import { InvoicesModule } from '../../../src/modules/finance/invoices.module';
import { PaymentsModule } from '../../../src/modules/finance/payments.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { createTestApp } from '../../support/test-app';
import {
  catalogIds,
  seedAccount,
  seedExpense,
  seedInvoice,
  seedPayment,
} from '../../finance/read-models/world';
import { seedClient, seedProject } from '../concurrency/world';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = '/api/v1';
const admin = createTestPrisma();
/** The finance seeds take the adapters' client type; outside a unit of work the host answers its base client. */
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const db = new TransactionHost(service).db;

/**
 * Package 6.3: `commercial`'s neutral finance ports are bound to finance (HU-08 CA3, C19) and the note link
 * registry knows the three finance targets. The app is the real `AppModule` plus the finance modules this
 * spec needs (6.1 wires them all).
 */
describe('commercial rebind to finance (e2e)', () => {
  let app: NestExpressApplication;
  const authenticator = new FakeAuthenticator();
  let owner = '';

  beforeAll(async () => {
    app = await createTestApp({
      modules: [InvoicesModule, PaymentsModule, ExpensesModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(admin);
    await service.client.$disconnect();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    const row = await admin.user.create({
      data: {
        clerkId: 'user_e2e_rebind',
        email: 'rebind@example.test',
        name: 'Owner',
        role: 'OWNER',
      },
    });
    const user: CurrentUser = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'OWNER',
      email: row.email,
      name: row.name,
    };
    owner = `Bearer ${authenticator.issue(user)}`;
    await seedClient(admin, 'cli_rb');
    await seedProject(admin, 'pry_rb', ['cli_rb']);
  });

  const http = () => request(app.getHttpServer());
  const post = (path: string, body: object) =>
    http().post(`${BASE}${path}`).set('Authorization', owner).send(body);
  const setStatus = (status: string) =>
    admin.project.update({
      where: { id: 'pry_rb' },
      data: { status: status as 'ENTREGADO', startDate: new Date('2026-01-01') },
    });

  describe('HU-08 CA3: cancelling a project closes its billing', () => {
    async function seedBilling() {
      await setStatus('EN_CURSO');
      await http()
        .put(`${BASE}/projects/pry_rb/billing-plan`)
        .set('Authorization', owner)
        .send({ model: 'PRECIO_FIJO', currency: 'USD', contractAmount: '1000' })
        .expect(200);
      for (const label of ['Cuota 1', 'Cuota 2']) {
        await post('/projects/pry_rb/installments', {
          kind: 'CUOTA',
          label,
          amount: '100',
          currency: 'USD',
        }).expect(200);
      }
      await post('/projects/pry_rb/recurring-charges', {
        label: 'Soporte',
        amount: '50',
        currency: 'USD',
        frequency: 'MENSUAL',
        startDate: '2026-11-01',
        billingDay: 5,
        leadDays: 7,
      }).expect(200);
    }

    it('cancels the pending installments and finishes the charges, and the entry says how many', async () => {
      await seedBilling();
      const res = await post('/projects/pry_rb/status', {
        status: 'CANCELADO',
        confirm: true,
        cancelPendingInstallments: true,
        finishRecurringCharges: true,
      }).expect(200);

      expect(res.body.project.status).toBe('CANCELADO');
      const installments = await admin.billingInstallment.findMany({
        where: { projectId: 'pry_rb' },
      });
      expect(installments).toHaveLength(2);
      for (const row of installments) {
        expect(row.status).toBe('CANCELADA');
        expect(row.cancelledAt).not.toBeNull();
      }
      const charge = await admin.recurringCharge.findFirstOrThrow({
        where: { projectId: 'pry_rb' },
      });
      expect(charge.status).toBe('FINALIZADO');
      const entry = await admin.activityLog.findFirstOrThrow({
        where: { entityType: 'PROJECT', entityId: 'pry_rb', action: 'STATUS_CHANGE' },
      });
      expect(entry.metadata).toMatchObject({
        cancelledInstallments: 2,
        finishedRecurringCharges: 1,
      });
    });

    it('leaves the billing alone when the user keeps it (both options false)', async () => {
      await seedBilling();
      await post('/projects/pry_rb/status', {
        status: 'CANCELADO',
        confirm: true,
        cancelPendingInstallments: false,
        finishRecurringCharges: false,
      }).expect(200);

      expect(await admin.billingInstallment.count({ where: { status: 'PENDIENTE' } })).toBe(2);
      const charge = await admin.recurringCharge.findFirstOrThrow({
        where: { projectId: 'pry_rb' },
      });
      expect(charge.status).not.toBe('FINALIZADO');
      const entry = await admin.activityLog.findFirstOrThrow({
        where: { entityType: 'PROJECT', entityId: 'pry_rb', action: 'STATUS_CHANGE' },
      });
      expect(entry.metadata).toMatchObject({
        cancelledInstallments: 0,
        finishedRecurringCharges: 0,
      });
    });
  });

  describe('archive locks with real invoices (C19)', () => {
    const archiveClient = (confirm: boolean) => post('/clients/cli_rb/archive', { confirm });
    const archiveProject = (confirm: boolean) => post('/projects/pry_rb/archive', { confirm });
    const invoice = (
      status: 'EMITIDA' | 'PARCIAL' | 'VENCIDA' | 'PAGADA' | 'ANULADA' | 'BORRADOR',
    ) =>
      seedInvoice(db, {
        id: `inv_rb_${status}`,
        clientId: 'cli_rb',
        status,
        lines: [
          { id: `lin_rb_${status}`, projectId: 'pry_rb', unitPrice: '100.00', ivaRate: null },
        ],
      });

    it.each(['EMITIDA', 'PARCIAL', 'VENCIDA'] as const)(
      'a %s invoice locks the client archive until confirm',
      async (status) => {
        await setStatus('ENTREGADO');
        await invoice(status);
        const locked = await archiveClient(false).expect(409);
        expect(locked.body.error).toMatchObject({
          code: 'INTEGRITY_LOCK',
          message: 'clients.errors.archiveNeedsConfirm',
          entity: { type: 'CLIENT', id: 'cli_rb' },
        });
        expect(
          (await admin.client.findUniqueOrThrow({ where: { id: 'cli_rb' } })).deletedAt,
        ).toBeNull();
        await archiveClient(true).expect(200);
      },
    );

    it.each(['PAGADA', 'ANULADA', 'BORRADOR'] as const)(
      'a %s invoice does not lock the client archive',
      async (status) => {
        await setStatus('ENTREGADO');
        await invoice(status);
        await archiveClient(false).expect(200);
      },
    );

    it('an issued invoice line locks the project archive until confirm', async () => {
      await setStatus('ENTREGADO');
      await invoice('EMITIDA');
      const locked = await archiveProject(false).expect(409);
      expect(locked.body.error).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'projects.errors.archiveNeedsConfirm',
      });
      await archiveProject(true).expect(200);
    });
  });

  describe('notes link to the finance targets', () => {
    it('links one note to an invoice, a payment and an expense', async () => {
      await setStatus('ENTREGADO');
      await seedInvoice(db, {
        id: 'inv_rb_n',
        clientId: 'cli_rb',
        lines: [{ id: 'lin_rb_n', projectId: 'pry_rb', unitPrice: '10.00', ivaRate: null }],
      });
      await seedAccount(db, 'acc_rb');
      const { methodId, categoryId } = await catalogIds(db);
      await seedPayment(db, {
        id: 'pay_rb_n',
        clientId: 'cli_rb',
        accountId: 'acc_rb',
        methodId,
        amount: '10.00',
      });
      await seedExpense(db, { id: 'exp_rb_n', categoryId, amount: '5.00' });

      const note = await post('/notes', {
        title: 'Seguimiento',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Acordado' }] }],
        },
        links: [{ entityType: 'CLIENT', entityId: 'cli_rb' }],
      }).expect(201);

      for (const [entityType, entityId] of [
        ['INVOICE', 'inv_rb_n'],
        ['PAYMENT', 'pay_rb_n'],
        ['EXPENSE', 'exp_rb_n'],
      ] as const) {
        const linked = await post(`/notes/${note.body.id}/links`, { entityType, entityId }).expect(
          201,
        );
        expect(
          linked.body.links.map((link: { type: string; id: string }) => `${link.type}:${link.id}`),
        ).toContain(`${entityType}:${entityId}`);
      }
      expect(await admin.noteLink.count({ where: { noteId: note.body.id } })).toBe(4);
    });
  });
});
