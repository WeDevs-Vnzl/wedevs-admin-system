import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../src/shared/application/current-user';
import { AUTHORIZATION } from '../src/shared/application/ports/tokens';
import type { UserRole } from '../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from './support/db';
import { FakeAuthenticator } from './support/fakes/fake-authenticator';
import { createTestApp } from './support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const V1 = '/api/v1';

/** `YYYY-MM-DD` of today plus `days` (UTC). */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

interface Ref {
  id: string;
}

/**
 * BE-3 money flow over the full `AppModule` (package 6.1): the real `MatrixAuthorization` and route guard, a fake
 * identity provider. plan -> installment -> taxed invoice -> partial cross-currency payment -> settle -> void
 * refused -> deallocate -> void, asserting each step's statuses, balances and metrics.
 */
describe('BE-3 flows (full app)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const tokens = {} as Record<UserRole, string>;
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      authenticator,
      probes: false,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `user_be3_${role.toLowerCase()}`,
          email: `be3-${role.toLowerCase()}@example.test`,
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
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  const call = (
    method: 'get' | 'post' | 'patch' | 'put',
    role: UserRole,
    path: string,
  ): request.Test =>
    request(app.getHttpServer())
      [method](`${V1}${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`);
  const get = (path: string, role: UserRole = 'OWNER') => call('get', role, path);
  const post = (path: string, body: object = {}, role: UserRole = 'OWNER') =>
    call('post', role, path).send(body);
  const put = (path: string, body: object, role: UserRole = 'OWNER') =>
    call('put', role, path).send(body);

  const clientMetrics = async (clientId: string) => {
    const row = await prisma.clientMetrics.findUniqueOrThrow({ where: { clientId } });
    return {
      invoicedUsd: row.invoicedUsd.toFixed(2),
      collectedUsd: row.collectedUsd.toFixed(2),
      receivableUsd: row.receivableUsd.toFixed(2),
      creditUsd: row.creditUsd.toFixed(2),
    };
  };
  const accountBalance = async (id: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { id } })).balance.toFixed(2);

  it('plan -> installment -> invoice -> partial cross-currency payment -> settle -> void refused -> deallocate -> void', async () => {
    // Setup through the API: client, project, two accounts (VES and USD).
    const client = (
      await post(
        '/clients',
        {
          kind: 'EMPRESA',
          tradeName: 'Nube Austral',
          legalName: 'Nube Austral C.A.',
          taxId: 'J-40111222-3',
          country: 'VE',
          address: 'Av. Principal, Caracas',
          phone: '+584121234567',
        },
        'ADMIN',
      ).expect(201)
    ).body as Ref;
    const project = (
      await post(
        '/projects',
        { name: 'Sitio web', summary: 'Sitio institucional', clients: [{ clientId: client.id }] },
        'ADMIN',
      ).expect(201)
    ).body as Ref;
    const account = async (name: string, currency: string) =>
      (
        await post('/accounts', {
          name,
          type: 'BANCO_INTERNACIONAL',
          currency,
          openingBalance: '0.00',
          openingDate: '2026-01-01',
        }).expect(201)
      ).body as Ref;
    const ves = await account('Banco VES', 'VES');
    const usd = await account('Zelle', 'USD');
    const zelle = (await prisma.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } })).id;

    // 1. Billing plan: fixed price 1000.00 USD, snapshot taken at save.
    const plan = await put(`/projects/${project.id}/billing-plan`, {
      model: 'PRECIO_FIJO',
      currency: 'USD',
      contractAmount: '1000.00',
    }).expect(200);
    expect(plan.body.plan).toMatchObject({ contractAmount: '1000.00', contractedUsd: '1000.00' });
    const metrics = await prisma.projectMetrics.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(metrics.contractedUsd.toFixed(2)).toBe('1000.00');

    // 2. Installment of 400.00 USD.
    const added = await post(`/projects/${project.id}/installments`, {
      kind: 'ANTICIPO',
      label: 'Anticipo 40 %',
      amount: '400.00',
      currency: 'USD',
      dueDate: dayOffset(30),
    }).expect(200);
    const installment = (added.body.installments as Ref[])[0] as Ref;
    const installmentStatus = async () =>
      (await prisma.billingInstallment.findUniqueOrThrow({ where: { id: installment.id } })).status;
    expect(await installmentStatus()).toBe('PENDIENTE');

    // 3. Invoice for the installment with 16 % IVA: 400.00 + 64.00 = 464.00 USD.
    const invoice = await post('/invoices', {
      clientId: client.id,
      invoiceNumber: 'F-0001',
      issueDate: dayOffset(-2),
      dueDate: dayOffset(28),
      currency: 'USD',
      usdRate: '1',
      lines: [
        {
          description: 'Anticipo',
          projectId: project.id,
          installmentId: installment.id,
          unitPrice: '400.00',
          ivaRate: '16',
        },
      ],
    }).expect(201);
    const invoiceId = (invoice.body as Ref).id;
    expect(invoice.body).toMatchObject({
      status: 'EMITIDA',
      totals: { taxBase: '400.00', ivaAmount: '64.00', total: '464.00', balance: '464.00' },
    });
    expect(await installmentStatus()).toBe('FACTURADA');
    expect(await clientMetrics(client.id)).toEqual({
      invoicedUsd: '464.00',
      collectedUsd: '0.00',
      receivableUsd: '464.00',
      creditUsd: '0.00',
    });

    // 4. Partial payment in VES at 40 VES/USD: 9 280.00 VES = 232.00 USD (half of the invoice).
    const first = (
      await post('/payments', {
        clientId: client.id,
        date: dayOffset(-1),
        accountId: ves.id,
        methodId: zelle,
        currency: 'VES',
        amount: '9280.00',
        usdRate: '40',
        reference: 'TR-1',
        allocations: [
          { invoiceId, amountPaymentCurrency: '9280.00', amountInvoiceCurrency: '232.00' },
        ],
      }).expect(201)
    ).body as Ref & { amountUsd: string; unallocated: string };
    expect(first).toMatchObject({ amountUsd: '232.00', unallocated: '0.00' });
    expect(await accountBalance(ves.id)).toBe('9280.00');
    const partial = (await get(`/invoices/${invoiceId}`).expect(200)).body;
    expect(partial).toMatchObject({
      status: 'PARCIAL',
      hasPartialPayment: true,
      totals: { paidAmount: '232.00', balance: '232.00' },
    });
    expect(await installmentStatus()).toBe('COBRADA_PARCIAL');
    expect(await clientMetrics(client.id)).toEqual({
      invoicedUsd: '464.00',
      collectedUsd: '232.00',
      receivableUsd: '232.00',
      creditUsd: '0.00',
    });

    // 5. Settle with a USD payment of 232.00.
    const second = (
      await post('/payments', {
        clientId: client.id,
        date: dayOffset(0),
        accountId: usd.id,
        methodId: zelle,
        currency: 'USD',
        amount: '232.00',
        usdRate: '1',
        reference: 'ZL-2',
        allocations: [
          { invoiceId, amountPaymentCurrency: '232.00', amountInvoiceCurrency: '232.00' },
        ],
      }).expect(201)
    ).body as Ref;
    expect(await accountBalance(usd.id)).toBe('232.00');
    const settled = (await get(`/invoices/${invoiceId}`).expect(200)).body as {
      status: string;
      totals: Record<string, string>;
      allocations: Ref[];
    };
    expect(settled).toMatchObject({
      status: 'PAGADA',
      totals: { paidAmount: '464.00', balance: '0.00' },
    });
    expect(settled.allocations).toHaveLength(2);
    expect(await installmentStatus()).toBe('COBRADA');
    expect(await clientMetrics(client.id)).toEqual({
      invoicedUsd: '464.00',
      collectedUsd: '464.00',
      receivableUsd: '0.00',
      creditUsd: '0.00',
    });

    // 6. Voiding an invoice with live allocations is refused and changes nothing.
    const refused = await post(`/invoices/${invoiceId}/void`, { reason: 'Error' }).expect(409);
    expect(refused.body.error.code).toBe('INTEGRITY_LOCK');
    expect((await get(`/invoices/${invoiceId}`).expect(200)).body.status).toBe('PAGADA');

    // 7. Deallocating both payments walks the invoice back and turns the payments into credit.
    for (const allocation of settled.allocations) {
      await post(`/allocations/${allocation.id}/deallocate`).expect(200);
    }
    expect((await get(`/invoices/${invoiceId}`).expect(200)).body).toMatchObject({
      status: 'EMITIDA',
      allocations: [],
      totals: { paidAmount: '0.00', balance: '464.00' },
    });
    expect(await installmentStatus()).toBe('FACTURADA');
    expect(await clientMetrics(client.id)).toEqual({
      invoicedUsd: '464.00',
      collectedUsd: '0.00',
      receivableUsd: '464.00',
      creditUsd: '464.00',
    });
    expect(await accountBalance(ves.id)).toBe('9280.00');
    expect(await accountBalance(usd.id)).toBe('232.00');
    expect(await prisma.paymentAllocation.count({ where: { deletedAt: null } })).toBe(0);
    expect(await prisma.paymentAllocation.count()).toBe(2);
    expect((await get(`/payments/${first.id}`).expect(200)).body.unallocated).toBe('9280.00');
    expect((await get(`/payments/${second.id}`).expect(200)).body.unallocated).toBe('232.00');

    // 8. Now the invoice can be voided: the installment is released and the aggregates drop it.
    const voided = await post(`/invoices/${invoiceId}/void`, { reason: 'Facturada por error' });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: 'ANULADA', voidReason: 'Facturada por error' });
    expect(await installmentStatus()).toBe('PENDIENTE');
    expect(await clientMetrics(client.id)).toEqual({
      invoicedUsd: '0.00',
      collectedUsd: '0.00',
      receivableUsd: '0.00',
      creditUsd: '464.00',
    });
    await post(`/invoices/${invoiceId}/void`, { reason: 'Otra vez' }).expect(409);
  });

  it('C13: Member and Viewer get FORBIDDEN on every finance endpoint they reach, with no side effect', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      for (const path of ['/invoices', '/payments', '/accounts', '/expenses', '/exchange-rates']) {
        const res = await get(path, role).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      await post('/payments', { clientId: 'x', amount: '1' }, role).expect(403);
      await post('/transfers', {}, role).expect(403);
    }
    expect(await prisma.payment.count()).toBe(0);
  });
});
