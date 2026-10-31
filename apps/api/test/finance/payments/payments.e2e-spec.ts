import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import { PaymentsModule } from '../../../src/modules/finance/payments.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { FileAccessRegistry } from '../../../src/modules/platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../../../src/modules/platform/application/ports/file-access.port';
import { TAGGABLE_TARGET_REGISTRY } from '../../../src/modules/settings/application/ports/taggable-target.port';
import type { TaggableTargetRegistry } from '../../../src/modules/settings/application/taggable-target.registry';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** `YYYY-MM-DD` of the business day plus `days` (UTC arithmetic on the current date). */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe('payments (e2e): HU-13, HU-14, HU-12 CA2-CA3', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let owner: { id: string };
  let zelle: string;
  let cash: string;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [PaymentsModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  afterAll(async () => {
    await truncateBusinessTables(admin);
    await app.close();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_pay_${role.toLowerCase()}`,
          email: `pay-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      if (role === 'OWNER') owner = row;
      const user: CurrentUser = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      tokens[role] = authenticator.issue(user);
    }
    for (const [id, code, name, taxId] of [
      ['cli_e2e', 'CLI-0001', 'Kairos', 'J-1'],
      ['cli_other', 'CLI-0002', 'Zafiro', 'J-2'],
    ] as const) {
      await admin.client.create({
        data: {
          id,
          code,
          kind: 'EMPRESA',
          tradeName: name,
          legalName: `${name} C.A.`,
          taxId,
          country: 'VE',
          address: 'Av. Principal',
          phone: '+584121234567',
        },
      });
    }
    for (const [id, code] of [
      ['pry_a', 'PRY-0001'],
      ['pry_b', 'PRY-0002'],
    ] as const) {
      await admin.project.create({
        data: {
          id,
          code,
          name: id,
          summary: 'Resumen',
          clients: { create: [{ clientId: 'cli_e2e' }] },
        },
      });
    }
    for (const [id, name, currency] of [
      ['acc_usd', 'Zelle', 'USD'],
      ['acc_usd_2', 'Caja', 'USD'],
      ['acc_ves', 'Banco VES', 'VES'],
    ] as const) {
      await admin.account.create({
        data: {
          id,
          name,
          type: 'BANCO_INTERNACIONAL',
          currency,
          openingBalance: '0.00',
          openingDate: new Date('2026-01-01'),
        },
      });
    }
    zelle = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } })).id;
    cash = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'EFECTIVO_USD' } })).id;
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());
  const post = (path: string, payload: object = {}, role: UserRole = 'OWNER') =>
    http().post(`${BASE}${path}`).set('Authorization', as(role)).send(payload);
  const get = (path: string, role: UserRole = 'OWNER') =>
    http().get(`${BASE}${path}`).set('Authorization', as(role));

  const body = (over: Record<string, unknown> = {}) => ({
    clientId: 'cli_e2e',
    date: dayOffset(-1),
    accountId: 'acc_usd',
    methodId: zelle,
    currency: 'USD',
    amount: '100.00',
    igtfAmount: '0.00',
    feeAmount: '0.00',
    usdRate: '1',
    reference: 'OP-1',
    ...over,
  });
  const create = async (over: Record<string, unknown> = {}, expected = 201) =>
    post('/payments', body(over)).expect(expected);

  let invoiceCount = 0;
  /** An invoice of Kairos through the API; exempt lines, so the receivable is the sum of the prices. */
  async function invoice(
    prices: string[] | string = '1000.00',
    over: Record<string, unknown> = {},
  ) {
    invoiceCount += 1;
    const list = Array.isArray(prices) ? prices : [prices];
    const response = await post('/invoices', {
      clientId: 'cli_e2e',
      invoiceNumber: `E2E-${invoiceCount}`,
      issueDate: dayOffset(-2),
      dueDate: dayOffset(28),
      currency: 'USD',
      usdRate: '1',
      lines: list.map((unitPrice, index) => ({
        description: `Linea ${index + 1}`,
        projectId: index === 0 ? 'pry_a' : 'pry_b',
        unitPrice,
        ivaRate: null,
      })),
      ...over,
    }).expect(201);
    return response.body as { id: string; code: string };
  }
  const apply = (invoiceId: string, payment: string, inv = payment) => ({
    invoiceId,
    amountPaymentCurrency: payment,
    amountInvoiceCurrency: inv,
  });
  const invoiceBody = async (id: string) => (await get(`/invoices/${id}`).expect(200)).body;
  const balanceOf = async (id: string) =>
    (await admin.account.findUniqueOrThrow({ where: { id } })).balance.toFixed(2);

  describe('HU-13 CA1-CA2: register a payment, IGTF and fees', () => {
    it('100 USD with IGTF 3 and fee 0: 97 allocatable, 100 credited to the account, and a PAG code', async () => {
      const response = await create({ igtfAmount: '3.00' });

      expect(response.body).toMatchObject({
        code: 'PAG-0001',
        status: 'CONFIRMADO',
        amount: '100.00',
        igtfAmount: '3.00',
        feeAmount: '0.00',
        allocatable: '97.00',
        netCredited: '100.00',
        allocated: '0.00',
        unallocated: '97.00',
        amountUsd: '100.00',
        allocations: [],
        client: { id: 'cli_e2e', label: 'Kairos' },
        account: { id: 'acc_usd', label: 'Zelle' },
        method: { id: zelle, code: 'ZELLE' },
        createdById: owner.id,
      });
      expect(await balanceOf('acc_usd')).toBe('100.00');
      const metrics = await admin.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_e2e' },
      });
      expect(metrics.creditUsd.toFixed(2)).toBe('97.00');
      const stored = await get(`/payments/${response.body.id}`).expect(200);
      expect(stored.body).toMatchObject({ id: response.body.id, unallocated: '97.00' });
      expect(await admin.searchEntry.count({ where: { entityType: 'PAYMENT' } })).toBe(1);
      const activity = await admin.activityLog.findFirstOrThrow({
        where: { entityType: 'PAYMENT', action: 'CREATE' },
      });
      expect(activity.entityId).toBe(response.body.id);
    });

    it('a fee lowers the net credited amount, not the allocatable one', async () => {
      const response = await create({ feeAmount: '2.50' });
      expect(response.body).toMatchObject({ netCredited: '97.50', allocatable: '100.00' });
      expect(await balanceOf('acc_usd')).toBe('97.50');
    });

    it('validates the shape with field errors (422), the method reference rule and the account currency', async () => {
      const missing = await post('/payments', {}).expect(422);
      expect(Object.keys(missing.body.error.fieldErrors)).toEqual(
        expect.arrayContaining(['clientId', 'date', 'accountId', 'methodId', 'currency', 'amount']),
      );
      const noReference = await create({ reference: undefined }, 422);
      expect(noReference.body.error.fieldErrors).toEqual({
        reference: ['payments.validation.referenceRequired'],
      });
      const cashPayment = await create({ reference: undefined, methodId: cash });
      expect(cashPayment.body.reference).toBeNull();
      const mismatch = await create({ currency: 'VES', usdRate: '36.5' }, 422);
      expect(mismatch.body.error.fieldErrors).toEqual({
        currency: ['payments.validation.currencyMismatch'],
      });
      const igtf = await create({ igtfAmount: '150.00' }, 422);
      expect(igtf.body.error.fieldErrors).toEqual({
        igtfAmount: ['payments.validation.igtfExceedsAmount'],
      });
      const rate = await create({ usdRate: '2' }, 422);
      expect(rate.body.error.fieldErrors).toEqual({
        usdRate: ['catalogs.validation.usdRateMustBeOne'],
      });
      await create({ clientId: 'cli_nope' }, 404);
      await create({ accountId: 'acc_nope' }, 404);
      await create({ methodId: 'pmt_nope' }, 404);
      expect(await admin.payment.count()).toBe(1);
    });
  });

  describe('HU-13 CA3 and HU-12 CA2-CA3: allocations and the invoice status', () => {
    it('applies a partial payment: the invoice goes PARCIAL, the rest stays as credit', async () => {
      const inv = await invoice('1000.00');
      const response = await create({
        amount: '300.00',
        allocations: [apply(inv.id, '250.00')],
      });

      expect(response.body).toMatchObject({ allocated: '250.00', unallocated: '50.00' });
      expect(response.body.allocations).toHaveLength(1);
      expect(response.body.allocations[0]).toMatchObject({
        invoice: { id: inv.id, code: inv.code },
        invoiceCurrency: 'USD',
        amountPaymentCurrency: '250.00',
        amountInvoiceCurrency: '250.00',
        amountUsd: '250.00',
      });
      expect(await invoiceBody(inv.id)).toMatchObject({
        status: 'PARCIAL',
        hasPartialPayment: true,
        totals: expect.objectContaining({ paidAmount: '250.00', balance: '750.00' }),
      });
      expect((await get('/clients/cli_e2e/credit').expect(200)).body).toMatchObject({
        totalUsd: '50.00',
      });
    });

    it('a balance of 0.01 or less settles the invoice (HU-12 CA3)', async () => {
      const inv = await invoice('100.00');
      await create({ allocations: [apply(inv.id, '99.99')] });
      const stored = await invoiceBody(inv.id);
      expect(stored.status).toBe('PAGADA');
      expect(stored.totals.balance).toBe('0.01');
    });

    it('refuses allocations above the allocatable amount or the invoice balance, and the wrong invoices', async () => {
      const big = await invoice('1000.00');
      const small = await invoice('50.00');
      const other = await post('/invoices', {
        clientId: 'cli_other',
        invoiceNumber: 'E2E-OTHER',
        issueDate: dayOffset(-2),
        dueDate: dayOffset(28),
        currency: 'USD',
        usdRate: '1',
        lines: [{ description: 'x', unitPrice: '100.00', ivaRate: null }],
      }).expect(201);
      const exceed = await create(
        { igtfAmount: '3.00', allocations: [apply(big.id, '60.00'), apply(small.id, '40.00')] },
        422,
      );
      expect(exceed.body.error.fieldErrors).toEqual({
        allocations: ['payments.validation.allocationsExceedAllocatable'],
      });
      const over = await create({ allocations: [apply(small.id, '60.00')] }, 422);
      expect(over.body.error.fieldErrors).toEqual({
        'allocations.0.amountInvoiceCurrency': ['payments.validation.allocationExceedsBalance'],
      });
      const foreign = await create({ allocations: [apply(other.body.id, '10.00')] }, 422);
      expect(foreign.body.error.fieldErrors).toEqual({
        'allocations.0.invoiceId': ['payments.validation.allocationInvoiceNotOpen'],
      });
      await create({ allocations: [apply('inv_nope', '10.00')] }, 404);
      expect(await admin.payment.count()).toBe(0);
      expect(await admin.paymentAllocation.count()).toBe(0);
    });

    it('allocates later, then deallocates: balances, credit and activity follow', async () => {
      const inv = await invoice('400.00');
      const payment = await create({ amount: '300.00' });
      const allocated = await post(
        `/payments/${payment.body.id}/allocations`,
        apply(inv.id, '120.00'),
      );
      expect(allocated.status).toBe(201);
      expect(allocated.body).toMatchObject({
        paymentId: payment.body.id,
        amountUsd: '120.00',
        invoice: { id: inv.id },
      });
      expect((await invoiceBody(inv.id)).totals).toMatchObject({
        paidAmount: '120.00',
        balance: '280.00',
      });
      expect((await get(`/payments/${payment.body.id}`).expect(200)).body).toMatchObject({
        allocated: '120.00',
        unallocated: '180.00',
      });
      const twice = await post(`/payments/${payment.body.id}/allocations`, apply(inv.id, '10.00'));
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('CONFLICT');

      const removed = await post(`/allocations/${allocated.body.id}/deallocate`).expect(200);
      expect(removed.body).toMatchObject({
        allocated: '0.00',
        unallocated: '300.00',
        allocations: [],
      });
      expect((await invoiceBody(inv.id)).totals).toMatchObject({
        paidAmount: '0.00',
        balance: '400.00',
      });
      expect((await invoiceBody(inv.id)).status).toBe('EMITIDA');
      const row = await admin.paymentAllocation.findUniqueOrThrow({
        where: { id: allocated.body.id },
      });
      expect(row.deletedAt).not.toBeNull();
      await post(`/allocations/${allocated.body.id}/deallocate`).expect(404);
      const actions = (
        await admin.activityLog.findMany({
          where: { entityId: payment.body.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((entry) => entry.action);
      expect(actions).toEqual(['CREATE', 'ALLOCATE', 'DEALLOCATE']);
    });
  });

  describe('HU-13 CA4: cross-currency allocation (§9.5)', () => {
    it('a VES payment on a USD invoice keeps the USD snapshot at the payment rate', async () => {
      const inv = await invoice('1000.00');
      const response = await create({
        accountId: 'acc_ves',
        currency: 'VES',
        amount: '36500.00',
        usdRate: '36.50',
        reference: 'VES-1',
        // The user edited the proposal down to 990 USD: the remaining 365 VES stays as credit.
        allocations: [apply(inv.id, '36135.00', '990.00')],
      });

      expect(response.body).toMatchObject({
        amountUsd: '1000.00',
        allocated: '36135.00',
        unallocated: '365.00',
      });
      expect(response.body.allocations[0]).toMatchObject({
        amountPaymentCurrency: '36135.00',
        amountInvoiceCurrency: '990.00',
        amountUsd: '990.00',
      });
      expect((await invoiceBody(inv.id)).totals).toMatchObject({
        paidAmount: '990.00',
        balance: '10.00',
      });
      expect(await balanceOf('acc_ves')).toBe('36500.00');
      const credit = (await get('/clients/cli_e2e/credit').expect(200)).body;
      expect(credit.payments[0]).toMatchObject({
        currency: 'VES',
        unallocated: '365.00',
        unallocatedUsd: '10.00',
      });
    });
  });

  describe('HU-13 CA5-CA6: credit and duplicates', () => {
    it('the credit lists the confirmed payments with a remainder; an unknown client is 404', async () => {
      await create({ igtfAmount: '3.00', reference: 'C-1' });
      await create({ status: 'PENDIENTE_VERIFICACION', reference: 'C-2' });
      const credit = (await get('/clients/cli_e2e/credit').expect(200)).body;
      expect(credit.totalUsd).toBe('97.00');
      expect(credit.payments).toHaveLength(1);
      await get('/clients/cli_nope/credit').expect(404);
      expect((await get('/clients/cli_other/credit').expect(200)).body).toEqual({
        totalUsd: '0.00',
        payments: [],
      });
    });

    it('warns of a duplicate and still saves it', async () => {
      const first = await create({ reference: 'OP-777' });
      const query = `methodId=${zelle}&accountId=acc_usd&reference=op-777`;
      const warning = (await get(`/payments/duplicates?${query}`).expect(200)).body;
      expect(warning.duplicate).toBe(true);
      expect(warning.matches).toEqual([
        expect.objectContaining({
          payment: expect.objectContaining({ id: first.body.id, code: 'PAG-0001' }),
          amount: '100.00',
          status: 'CONFIRMADO',
        }),
      ]);
      const own = (
        await get(`/payments/duplicates?${query}&excludePaymentId=${first.body.id}`).expect(200)
      ).body;
      expect(own).toEqual({ duplicate: false, matches: [] });
      await get(`/payments/duplicates?methodId=${zelle}&accountId=acc_usd`).expect(422);
      const second = await create({ reference: 'OP-777' });
      expect(second.body.code).toBe('PAG-0002');
      expect(await admin.payment.count()).toBe(2);
    });

    it('opens the form from an invoice only while it takes a payment', async () => {
      const inv = await invoice('300.00');
      const context = (await get(`/invoices/${inv.id}/payment-context`).expect(200)).body;
      expect(context.client).toMatchObject({ id: 'cli_e2e', label: 'Kairos' });
      expect(context.invoice).toMatchObject({
        id: inv.id,
        balance: '300.00',
        status: 'EMITIDA',
        currency: 'USD',
      });
      await post(`/invoices/${inv.id}/void`, { reason: 'Error' }).expect(200);
      await get(`/invoices/${inv.id}/payment-context`).expect(404);
      await get('/invoices/inv_nope/payment-context').expect(404);
    });
  });

  describe('HU-14: the receipt (DT-41, C23)', () => {
    async function file(id: string, mimeType: string, sizeBytes: number, uploadedById = owner.id) {
      await admin.file.create({
        data: {
          id,
          storageKey: `payments/${id}`,
          bucket: 'test',
          originalName: `${id}.bin`,
          mimeType,
          sizeBytes,
          status: 'READY',
          uploadedById,
        },
      });
    }

    it('accepts PDF and images up to 10 MB, claims the file and refuses the rest', async () => {
      await file('file_pdf', 'application/pdf', 1000);
      await file('file_png', 'image/png', 2000);
      await file('file_zip', 'application/zip', 1000);
      await file('file_big', 'application/pdf', 10 * 1024 * 1024 + 1);
      const other = await admin.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
      await file('file_foreign', 'application/pdf', 1000, other.id);

      const created = await create({ receiptFileId: 'file_pdf', reference: 'R-1' });
      expect(created.body.receiptFileId).toBe('file_pdf');
      expect(
        await app.get<FileAccessRegistry>(FILE_ACCESS_REGISTRY).claimsFor('file_pdf'),
      ).toContainEqual({
        kind: 'resource',
        resource: 'payment',
      });
      expect(
        (await create({ receiptFileId: 'file_zip', reference: 'R-2' }, 422)).body.error.fieldErrors,
      ).toEqual({
        receiptFileId: ['validation.file.typeNotAllowed'],
      });
      expect(
        (await create({ receiptFileId: 'file_big', reference: 'R-3' }, 422)).body.error.fieldErrors,
      ).toEqual({
        receiptFileId: ['validation.file.tooLargeMax'],
      });
      await create({ receiptFileId: 'file_nope', reference: 'R-4' }, 404);
      await create({ receiptFileId: 'file_foreign', reference: 'R-5' }, 404);
      // The file is the receipt of one payment only.
      const again = await create({ receiptFileId: 'file_pdf', reference: 'R-6' }, 422);
      expect(again.body.error.fieldErrors).toEqual({
        receiptFileId: ['payments.validation.receiptUnavailable'],
      });

      const patched = await http()
        .patch(`${BASE}/payments/${created.body.id}`)
        .set('Authorization', as('OWNER'))
        .send({ ...body({ reference: 'R-1' }), receiptFileId: 'file_png' })
        .expect(200);
      expect(patched.body.receiptFileId).toBe('file_png');
      const detached = await http()
        .patch(`${BASE}/payments/${created.body.id}`)
        .set('Authorization', as('OWNER'))
        .send({ ...body({ reference: 'R-1' }), receiptFileId: null })
        .expect(200);
      expect(detached.body.receiptFileId).toBeNull();
    });
  });

  describe('DT-98: the facts and metrics of a payment', () => {
    it('splits the collected amount per project line at the payment rate and records the IGTF', async () => {
      const inv = await invoice(['60.00', '40.00']);
      const payment = await create({ igtfAmount: '3.00', allocations: [apply(inv.id, '97.00')] });

      const facts = await admin.financeFact.findMany({
        where: { sourceType: 'PAYMENT', sourceId: payment.body.id },
        orderBy: [{ kind: 'asc' }, { projectId: 'asc' }],
      });
      expect(facts.map((fact) => [fact.kind, fact.projectId, fact.amountUsd.toFixed(2)])).toEqual([
        ['COLLECTED', 'pry_a', '58.20'],
        ['COLLECTED', 'pry_b', '38.80'],
        ['IGTF', null, '3.00'],
      ]);
      expect(facts.every((fact) => fact.clientId === 'cli_e2e' && fact.methodId === zelle)).toBe(
        true,
      );

      const clientMetrics = await admin.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_e2e' },
      });
      expect(clientMetrics.collectedUsd.toFixed(2)).toBe('97.00');
      expect(clientMetrics.receivableUsd.toFixed(2)).toBe('3.00');
      expect(clientMetrics.creditUsd.toFixed(2)).toBe('0.00');
      const projects = await admin.projectMetrics.findMany({ orderBy: { projectId: 'asc' } });
      expect(projects.map((row) => [row.projectId, row.collectedUsd.toFixed(2)])).toEqual([
        ['pry_a', '58.20'],
        ['pry_b', '38.80'],
      ]);
    });
  });

  describe('update and status (Q-BE3-3)', () => {
    it('edits a payment, locks client and currency with allocations and never lets the amount drop below them', async () => {
      const inv = await invoice('500.00');
      const payment = await create({ allocations: [apply(inv.id, '80.00')] });
      const patch = (over: Record<string, unknown>, expected = 200) =>
        http()
          .patch(`${BASE}/payments/${payment.body.id}`)
          .set('Authorization', as('OWNER'))
          .send(body({ reference: 'OP-1', ...over }))
          .expect(expected);

      const edited = await patch({ reference: 'OP-EDITED', date: dayOffset(-3) });
      expect(edited.body).toMatchObject({ reference: 'OP-EDITED', allocated: '80.00' });
      const moved = await patch({ accountId: 'acc_usd_2' });
      expect(moved.body.account.id).toBe('acc_usd_2');
      expect(await balanceOf('acc_usd')).toBe('0.00');
      expect(await balanceOf('acc_usd_2')).toBe('100.00');
      expect((await patch({ clientId: 'cli_other' }, 409)).status).toBe(409);
      expect((await patch({ amount: '70.00' }, 409)).body.error).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'payments.errors.allocatableBelowAllocated',
      });
      await patch({ methodId: 'pmt_nope' }, 404);
    });

    it('confirms a pending payment, then voids it: the invoice, the account and the facts follow', async () => {
      const inv = await invoice('400.00');
      const payment = await create({
        status: 'PENDIENTE_VERIFICACION',
        allocations: [apply(inv.id, '100.00')],
      });
      expect((await invoiceBody(inv.id)).status).toBe('EMITIDA');
      expect(await admin.financeFact.count({ where: { kind: 'COLLECTED' } })).toBe(0);

      const confirmed = await post(`/payments/${payment.body.id}/status`, {
        status: 'CONFIRMADO',
        reason: 'Verificado',
      }).expect(200);
      expect(confirmed.body.status).toBe('CONFIRMADO');
      expect((await invoiceBody(inv.id)).totals).toMatchObject({
        paidAmount: '100.00',
        balance: '300.00',
      });
      expect(await balanceOf('acc_usd')).toBe('100.00');
      expect(await admin.financeFact.count({ where: { kind: 'COLLECTED' } })).toBeGreaterThan(0);

      const voided = await post(`/payments/${payment.body.id}/status`, {
        status: 'ANULADO',
        reason: 'Duplicado',
      }).expect(200);
      expect(voided.body).toMatchObject({
        status: 'ANULADO',
        allocations: [],
        unallocated: '100.00',
      });
      expect((await invoiceBody(inv.id)).totals).toMatchObject({
        paidAmount: '0.00',
        balance: '400.00',
      });
      expect((await invoiceBody(inv.id)).status).toBe('EMITIDA');
      expect(await balanceOf('acc_usd')).toBe('0.00');
      expect(await admin.financeFact.count({ where: { kind: 'COLLECTED' } })).toBe(0);
      const entry = await admin.activityLog.findFirstOrThrow({
        where: { entityId: payment.body.id, action: 'STATUS_CHANGE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry.metadata).toMatchObject({
        from: 'CONFIRMADO',
        to: 'ANULADO',
        reason: 'Duplicado',
      });

      const again = await post(`/payments/${payment.body.id}/status`, { status: 'CONFIRMADO' });
      expect(again.status).toBe(409);
      expect(again.body.error.message).toBe('payments.errors.voided');
      await post(`/payments/${payment.body.id}/status`, { status: 'LOST' }).expect(422);
      await post('/payments/pay_nope/status', { status: 'ANULADO' }).expect(404);
    });
  });

  describe('reads', () => {
    it('lists with the facets, a sort and the page envelope; an unknown payment is 404', async () => {
      const a = await create({ reference: 'L-1', amount: '300.00', igtfAmount: '3.00' });
      await create({ reference: 'L-2', amount: '500.00', accountId: 'acc_usd_2', methodId: cash });
      await create({ reference: 'L-3', status: 'PENDIENTE_VERIFICACION' });

      const all = (await get('/payments').expect(200)).body;
      expect(all).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
      expect(all.items[0]).toEqual(
        expect.objectContaining({
          client: expect.objectContaining({ id: 'cli_e2e' }),
          method: expect.any(Object),
        }),
      );
      const ids = async (query: string) =>
        ((await get(`/payments?${query}`).expect(200)).body.items as { reference: string }[]).map(
          (row) => row.reference,
        );
      expect(await ids('status=PENDIENTE_VERIFICACION')).toEqual(['L-3']);
      expect(await ids('accountId=acc_usd_2')).toEqual(['L-2']);
      expect(await ids(`methodId=${cash}`)).toEqual(['L-2']);
      expect(await ids('q=L-1')).toEqual(['L-1']);
      expect(await ids('sort=amount:desc')).toEqual(['L-2', 'L-1', 'L-3']);
      expect(await ids('sort=allocated:asc&hasUnallocated=true')).toHaveLength(3);
      expect(await ids('clientId=cli_other')).toEqual([]);
      await get('/payments?status=LOST').expect(422);
      await get('/payments?sort=client:asc').expect(422);
      await get('/payments/pay_nope').expect(404);
      expect((await get(`/payments/${a.body.id}`).expect(200)).body.code).toBe('PAG-0001');
    });

    it('registers the payment in the tag and note registries', async () => {
      const payment = await create();
      const resolver = app
        .get<TaggableTargetRegistry>(TAGGABLE_TARGET_REGISTRY)
        .resolverFor('PAYMENT');
      expect(resolver).toBeDefined();
      expect(await resolver?.resolve(payment.body.id)).toEqual({
        label: 'PAG-0001',
        clientId: 'cli_e2e',
      });
      const refs = await app
        .get(NoteLinkTargetRegistry)
        .requireLive([{ entityType: 'PAYMENT', entityId: payment.body.id }], () => 'links');
      expect(refs[0]).toMatchObject({ type: 'PAYMENT', id: payment.body.id, code: 'PAG-0001' });
      const tag = await admin.tag.create({ data: { name: 'vip', color: '#ff0000' } });
      await admin.tagAssignment.create({ data: { tagId: tag.id, paymentId: payment.body.id } });
      const tagged = (await get(`/payments?tagId=${tag.id}`).expect(200)).body.items;
      expect(tagged.map((row: { id: string }) => row.id)).toEqual([payment.body.id]);
    });
  });

  describe('permissions (PRD §4.3, C13)', () => {
    it('Member and Viewer get 403 on every payment route; the Admin may read and write', async () => {
      const inv = await invoice('100.00');
      const payment = await create({ allocations: [apply(inv.id, '10.00')] });
      const id = payment.body.id;
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        const auth = as(role);
        await http().get(`${BASE}/payments`).set('Authorization', auth).expect(403);
        await http().get(`${BASE}/payments/${id}`).set('Authorization', auth).expect(403);
        await http()
          .get(`${BASE}/payments/duplicates?methodId=${zelle}&accountId=acc_usd&reference=x`)
          .set('Authorization', auth)
          .expect(403);
        await http().post(`${BASE}/payments`).set('Authorization', auth).send(body()).expect(403);
        await http()
          .patch(`${BASE}/payments/${id}`)
          .set('Authorization', auth)
          .send(body())
          .expect(403);
        await http()
          .post(`${BASE}/payments/${id}/status`)
          .set('Authorization', auth)
          .send({ status: 'ANULADO' })
          .expect(403);
        await http()
          .post(`${BASE}/payments/${id}/allocations`)
          .set('Authorization', auth)
          .send(apply(inv.id, '1.00'))
          .expect(403);
        await http()
          .post(`${BASE}/allocations/${payment.body.allocations[0].id}/deallocate`)
          .set('Authorization', auth)
          .expect(403);
        await http().get(`${BASE}/clients/cli_e2e/credit`).set('Authorization', auth).expect(403);
        await http()
          .get(`${BASE}/invoices/${inv.id}/payment-context`)
          .set('Authorization', auth)
          .expect(403);
      }
      await http().get(`${BASE}/payments/${id}`).expect(401);
      await get('/payments', 'ADMIN').expect(200);
      await post('/payments', body({ reference: 'ADM-1' }), 'ADMIN').expect(201);
      expect(await admin.payment.count()).toBe(2);
    });
  });
});
