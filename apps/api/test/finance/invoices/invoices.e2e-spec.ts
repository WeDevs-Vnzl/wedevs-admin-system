import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { MarkOverdueInvoices } from '../../../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { InvoicesModule } from '../../../src/modules/finance/invoices.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { FileAccessRegistry } from '../../../src/modules/platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../../../src/modules/platform/application/ports/file-access.port';
import { RESTORE_HANDLER_REGISTRY } from '../../../src/modules/platform/application/ports/restore-handler.port';
import type { RestoreHandlerRegistry } from '../../../src/modules/platform/application/restore-handler.registry';
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

describe('invoices (e2e): HU-11, HU-12', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [InvoicesModule],
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
          clerkId: `user_e2e_inv_${role.toLowerCase()}`,
          email: `inv-${role.toLowerCase()}@example.test`,
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
    await admin.project.create({
      data: {
        id: 'pry_e2e',
        code: 'PRY-0001',
        name: 'Kairos Web',
        summary: 'Resumen',
        clients: { create: [{ clientId: 'cli_e2e' }] },
      },
    });
    for (const [id, order, label, amount] of [
      ['ins_e2e_1', 0, 'Anticipo', '4000.00'],
      ['ins_e2e_2', 1, 'Hito de diseño', '3000.00'],
      ['ins_e2e_3', 2, 'Final', '3000.00'],
    ] as const) {
      await admin.billingInstallment.create({
        data: {
          id,
          projectId: 'pry_e2e',
          kind: 'HITO',
          label,
          amount,
          currency: 'USD',
          order,
          percentage: '40',
        },
      });
    }
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());
  const body = (over: Record<string, unknown> = {}) => ({
    clientId: 'cli_e2e',
    invoiceNumber: 'KAI-0001',
    issueDate: dayOffset(-1),
    dueDate: dayOffset(29),
    currency: 'USD',
    usdRate: '1',
    lines: [{ description: 'Servicio', unitPrice: '100.00', ivaRate: '16' }],
    ...over,
  });
  const create = async (over: Record<string, unknown> = {}, expected = 201) =>
    http()
      .post(`${BASE}/invoices`)
      .set('Authorization', as('OWNER'))
      .send(body(over))
      .expect(expected);
  const post = (path: string, payload: object = {}, role: UserRole = 'OWNER') =>
    http().post(`${BASE}${path}`).set('Authorization', as(role)).send(payload);

  async function seedAllocation(invoiceId: string, amount: string) {
    const method = await admin.paymentMethod.findFirstOrThrow({ orderBy: { code: 'asc' } });
    await admin.account.create({
      data: {
        id: 'acc_inv',
        name: 'Zelle',
        type: 'BANCO_INTERNACIONAL',
        currency: 'USD',
        openingBalance: '0.00',
        openingDate: new Date('2026-01-01'),
      },
    });
    await admin.payment.create({
      data: {
        id: 'pay_inv',
        code: 'PAG-9001',
        clientId: 'cli_e2e',
        date: new Date(),
        accountId: 'acc_inv',
        methodId: method.id,
        currency: 'USD',
        amount,
        igtfAmount: '0.00',
        feeAmount: '0.00',
        netCredited: amount,
        allocatable: amount,
        unallocated: '0.00',
        usdRate: '1',
        amountUsd: amount,
        status: 'CONFIRMADO',
        allocations: {
          create: [
            {
              id: 'alo_inv',
              invoiceId,
              amountPaymentCurrency: amount,
              amountInvoiceCurrency: amount,
              amountUsd: amount,
            },
          ],
        },
      },
    });
  }

  describe('HU-11 CA1-CA3: register an invoice, derived totals, unique number', () => {
    it('creates an invoice with a FAC code, nested totals and per-rate tax lines, derived by the BE (C17)', async () => {
      const response = await create({
        lines: [
          {
            description: 'A',
            quantity: '2',
            unitPrice: '100.00',
            discount: '20.00',
            ivaRate: '16',
          },
          { description: 'B', unitPrice: '50.00', ivaRate: '8' },
          { description: 'D', unitPrice: '10.00', ivaRate: null },
        ],
      });
      expect(response.body).toMatchObject({
        code: 'FAC-0001',
        status: 'EMITIDA',
        client: { type: 'CLIENT', id: 'cli_e2e', label: 'Kairos' },
        totals: {
          subtotal: '260.00',
          discount: '20.00',
          exemptAmount: '10.00',
          taxBase: '230.00',
          ivaAmount: '32.80',
          total: '272.80',
          receivable: '272.80',
          totalUsd: '272.80',
          paidAmount: '0.00',
          balance: '272.80',
          balanceUsd: '272.80',
        },
        daysOverdue: 0,
        hasPartialPayment: false,
        archivedAt: null,
        file: null,
        allocations: [],
      });
      expect(response.body.lines[0]).toMatchObject({
        amount: '200.00',
        netAmount: '180.00',
        ivaRate: '16',
      });
      expect(response.body.taxLines).toEqual([
        { ivaRate: '16', taxBase: '180.00', ivaAmount: '28.80', adjustment: '0.00' },
        { ivaRate: '8', taxBase: '50.00', ivaAmount: '4.00', adjustment: '0.00' },
      ]);
      const stored = await http()
        .get(`${BASE}/invoices/${response.body.id}`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(stored.body.totals.total).toBe('272.80');
    });

    it('CA3: a taken number (trimmed, case ignored) is a 409 CONFLICT pointing at the holder; archived frees it', async () => {
      const first = await create();
      const taken = await create({ invoiceNumber: ' kai-0001 ' }, 409);
      expect(taken.body.error).toMatchObject({
        code: 'CONFLICT',
        fieldErrors: { invoiceNumber: ['invoices.errors.numberTaken'] },
        entity: { type: 'INVOICE', id: first.body.id, label: 'KAI-0001' },
      });
      await post(`/invoices/${first.body.id}/archive`).expect(200);
      await create({ invoiceNumber: 'KAI-0001' });
    });

    it('validates the shape with field errors (422 VALIDATION) and unknown clients with 404', async () => {
      const bad = await create(
        { dueDate: dayOffset(-5), lines: [{ description: '', unitPrice: '10.00', ivaRate: '12' }] },
        422,
      );
      expect(bad.body.error.fieldErrors).toMatchObject({
        dueDate: ['invoices.validation.dueBeforeIssue'],
        'lines.0.description': ['validation.required'],
        'lines.0.ivaRate': ['invoices.validation.ivaRateNotAllowed'],
      });
      await create({ clientId: 'cli_nope' }, 404);
    });

    it('updates an invoice and logs total: [before, after] (HU-29 CA1); PATCH replaces the lines', async () => {
      const created = await create();
      const updated = await http()
        .patch(`${BASE}/invoices/${created.body.id}`)
        .set('Authorization', as('OWNER'))
        .send(
          body({
            lines: [
              {
                id: created.body.lines[0].id,
                description: 'Más',
                unitPrice: '2000.00',
                ivaRate: '16',
              },
            ],
          }),
        )
        .expect(200);
      expect(updated.body.totals.total).toBe('2320.00');
      expect(updated.body.lines[0].id).toBe(created.body.lines[0].id);
      const entry = await admin.activityLog.findFirstOrThrow({
        where: { entityType: 'INVOICE', entityId: created.body.id, action: 'UPDATE' },
      });
      expect(entry.changes).toMatchObject({ total: ['116.00', '2320.00'] });
      const metrics = await admin.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_e2e' },
      });
      expect(metrics.invoicedUsd.toFixed(2)).toBe('2320.00');
    });
  });

  describe('mixed-rate invoice (DT-44): 16 %, 8 %, 0 % and exempt', () => {
    it('stores per-rate tax lines, keeps the +0.01 adjustment, and writes the facts per rate', async () => {
      const response = await create({
        lines: [
          {
            description: 'A',
            projectId: 'pry_e2e',
            unitPrice: '1000.00',
            discount: '100.00',
            ivaRate: '16',
          },
          { description: 'B', projectId: 'pry_e2e', unitPrice: '500.00', ivaRate: '8' },
          { description: 'C', projectId: 'pry_e2e', unitPrice: '200.00', ivaRate: '0' },
          { description: 'D', projectId: 'pry_e2e', unitPrice: '300.00', ivaRate: null },
        ],
        taxAdjustments: [{ ivaRate: '8', adjustment: '0.01' }],
      });
      expect(response.body.totals).toMatchObject({
        subtotal: '2000.00',
        discount: '100.00',
        exemptAmount: '300.00',
        taxBase: '1600.00',
        ivaAmount: '184.01',
        total: '2084.01',
      });
      expect(response.body.taxLines).toEqual([
        { ivaRate: '16', taxBase: '900.00', ivaAmount: '144.00', adjustment: '0.00' },
        { ivaRate: '8', taxBase: '500.00', ivaAmount: '40.01', adjustment: '0.01' },
        { ivaRate: '0', taxBase: '200.00', ivaAmount: '0.00', adjustment: '0.00' },
      ]);

      const facts = await admin.financeFact.findMany({
        where: { invoiceId: response.body.id },
        orderBy: [{ kind: 'asc' }, { ivaRate: 'asc' }],
      });
      // BILLED splits the USD total over the lines by net amount (one fact per line, summing to the total);
      // IVA has one fact per rate and the 0 % rate, which carries no IVA, writes none.
      const billed = facts.filter((f) => f.kind === 'BILLED');
      expect(billed).toHaveLength(4);
      expect(billed.reduce((sum, f) => sum + Number(f.amountUsd), 0).toFixed(2)).toBe('2084.01');
      expect(
        facts
          .filter((f) => f.kind === 'IVA')
          .map((f) => [f.ivaRate?.toFixed(0), f.amountUsd.toFixed(2)]),
      ).toEqual([
        ['8', '40.01'],
        ['16', '144.00'],
      ]);
      const project = await admin.projectMetrics.findUniqueOrThrow({
        where: { projectId: 'pry_e2e' },
      });
      // A project's invoiced amount is the net of its lines (IVA is the client's, PRD §8.4.4).
      expect(project.invoicedUsd.toFixed(2)).toBe('1900.00');
      const client = await admin.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_e2e' },
      });
      expect(client.invoicedUsd.toFixed(2)).toBe('2084.01');
      expect(client.receivableUsd.toFixed(2)).toBe('2084.01');
    });

    it('refuses an adjustment above 0.01 or on a rate no line uses (VALIDATION)', async () => {
      const high = await create({ taxAdjustments: [{ ivaRate: '16', adjustment: '0.02' }] }, 422);
      expect(high.body.error.fieldErrors).toEqual({
        'taxAdjustments.0.adjustment': ['invoices.validation.adjustmentOutOfRange'],
      });
      await create({ taxAdjustments: [{ ivaRate: '8', adjustment: '0.01' }] }, 422);
    });
  });

  describe('HU-11 CA4: PDF', () => {
    it('attaches, replaces and detaches a READY file through PUT /invoices/{id}/file and exposes the download claim', async () => {
      const owner = await admin.user.findFirstOrThrow({ where: { role: 'OWNER' } });
      for (const [id, mimeType, sizeBytes] of [
        ['file_pdf', 'application/pdf', 1000],
        ['file_txt', 'text/plain', 10],
        ['file_big', 'application/pdf', 11 * 1024 * 1024],
      ] as const) {
        await admin.file.create({
          data: {
            id,
            storageKey: `invoices/${id}`,
            bucket: 'test',
            originalName: `${id}.bin`,
            mimeType,
            sizeBytes,
            status: 'READY',
            uploadedById: owner.id,
          },
        });
      }
      const created = await create();
      const put = (fileId: string | null, expected = 200) =>
        http()
          .put(`${BASE}/invoices/${created.body.id}/file`)
          .set('Authorization', as('OWNER'))
          .send({ fileId })
          .expect(expected);

      const attached = await put('file_pdf');
      expect(attached.body.fileId).toBe('file_pdf');
      expect(attached.body.file).toMatchObject({
        id: 'file_pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        status: 'READY',
      });
      expect(
        await app.get<FileAccessRegistry>(FILE_ACCESS_REGISTRY).claimsFor('file_pdf'),
      ).toContainEqual({
        kind: 'resource',
        resource: 'invoice',
      });
      expect((await put('file_txt', 422)).body.error.fieldErrors).toEqual({
        fileId: ['invoices.validation.fileType'],
      });
      expect((await put('file_big', 422)).body.error.fieldErrors).toEqual({
        fileId: ['invoices.validation.fileTooLarge'],
      });
      expect((await put('file_nope', 422)).body.error.fieldErrors).toEqual({
        fileId: ['invoices.validation.fileNotReady'],
      });
      expect((await put(null)).body.fileId).toBeNull();
    });
  });

  describe('HU-11 CA5: billing installments', () => {
    const lines = (...rows: [string, string][]) =>
      rows.map(([installmentId, unitPrice]) => ({
        description: installmentId,
        installmentId,
        unitPrice,
        ivaRate: '16',
      }));

    it('lists the pending installments and marks the billed ones FACTURADA; a project comes from the installment', async () => {
      const before = await http()
        .get(`${BASE}/clients/cli_e2e/billable-installments`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(before.body.map((r: { installment: { id: string } }) => r.installment.id)).toEqual([
        'ins_e2e_1',
        'ins_e2e_2',
        'ins_e2e_3',
      ]);
      expect(before.body[0]).toMatchObject({
        project: { type: 'PROJECT', id: 'pry_e2e' },
        kind: 'HITO',
        currency: 'USD',
        amount: '4000.00',
        remainingAmount: '4000.00',
      });

      const created = await create({
        lines: lines(['ins_e2e_1', '4000.00'], ['ins_e2e_2', '3000.00']),
      });
      expect(created.body.lines.map((l: { project: { id: string } }) => l.project.id)).toEqual([
        'pry_e2e',
        'pry_e2e',
      ]);
      expect(created.body.totals.total).toBe('8120.00');
      const states = await admin.billingInstallment.findMany({ orderBy: { order: 'asc' } });
      expect(states.map((s) => s.status)).toEqual(['FACTURADA', 'FACTURADA', 'PENDIENTE']);

      const after = await http()
        .get(`${BASE}/clients/cli_e2e/billable-installments`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(after.body.map((r: { installment: { id: string } }) => r.installment.id)).toEqual([
        'ins_e2e_3',
      ]);
      await http()
        .get(`${BASE}/clients/cli_nope/billable-installments`)
        .set('Authorization', as('OWNER'))
        .expect(404);
    });

    it('refuses over-billing (422) and an installment of another client, and voiding releases the installment', async () => {
      const first = await create({ lines: lines(['ins_e2e_1', '4000.00']) });
      const over = await create(
        { invoiceNumber: 'KAI-0002', lines: lines(['ins_e2e_1', '1.00']) },
        422,
      );
      expect(over.body.error.fieldErrors).toEqual({
        'lines.0.unitPrice': ['invoices.errors.installmentExceeded'],
      });
      const other = await create(
        { clientId: 'cli_other', invoiceNumber: 'ZAF-1', lines: lines(['ins_e2e_2', '10.00']) },
        422,
      );
      expect(other.body.error.fieldErrors).toEqual({
        'lines.0.installmentId': ['invoices.errors.projectOtherClient'],
      });

      await post(`/invoices/${first.body.id}/void`, { reason: 'Duplicada' }).expect(200);
      const installment = await admin.billingInstallment.findUniqueOrThrow({
        where: { id: 'ins_e2e_1' },
      });
      expect(installment.status).toBe('PENDIENTE');
      await create({ invoiceNumber: 'KAI-0003', lines: lines(['ins_e2e_1', '4000.00']) });
    });
  });

  describe('HU-12: status, void, archive, restore', () => {
    it('CA1: a fresh invoice is EMITIDA; a past due date makes it VENCIDA with its days overdue', async () => {
      expect((await create()).body.status).toBe('EMITIDA');
      const overdue = await create({
        invoiceNumber: 'KAI-OLD',
        issueDate: dayOffset(-40),
        dueDate: dayOffset(-10),
      });
      expect(overdue.body).toMatchObject({ status: 'VENCIDA', daysOverdue: expect.any(Number) });
      expect(overdue.body.daysOverdue).toBeGreaterThanOrEqual(9);
      const client = await admin.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_e2e' },
      });
      expect(client.overdueUsd.toFixed(2)).toBe('116.00');
    });

    it('CA4: the overdue step turns EMITIDA into VENCIDA once, projecting the client (idempotent)', async () => {
      const created = await create();
      await admin.invoice.update({
        where: { id: created.body.id },
        data: { dueDate: new Date(dayOffset(-3)) },
      });
      const step = app.get(MarkOverdueInvoices);
      expect(await step.execute(SYSTEM_ACTOR)).toEqual({
        updated: 1,
        invoiceIds: [created.body.id],
      });
      expect(await step.execute(SYSTEM_ACTOR)).toEqual({ updated: 0, invoiceIds: [] });
      const row = await admin.invoice.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.status).toBe('VENCIDA');
      const client = await admin.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_e2e' },
      });
      expect(client.overdueUsd.toFixed(2)).toBe('116.00');
      expect(
        await admin.activityLog.count({
          where: { action: 'SYSTEM_JOB', entityId: created.body.id },
        }),
      ).toBe(1);
    });

    it('CA5: voiding needs a reason, is refused with allocations (INTEGRITY_LOCK) and archive is refused too', async () => {
      const created = await create();
      expect(
        (await post(`/invoices/${created.body.id}/void`, {}).expect(422)).body.error.fieldErrors,
      ).toMatchObject({
        reason: ['validation.required'],
      });
      await seedAllocation(created.body.id, '50.00');
      const locked = await post(`/invoices/${created.body.id}/void`, { reason: 'Error' }).expect(
        409,
      );
      expect(locked.body.error.code).toBe('INTEGRITY_LOCK');
      const archive = await post(`/invoices/${created.body.id}/archive`).expect(409);
      expect(archive.body.error).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'invoices.errors.hasAllocations',
      });
      const edit = await http()
        .patch(`${BASE}/invoices/${created.body.id}`)
        .set('Authorization', as('OWNER'))
        .send(body({ clientId: 'cli_other' }))
        .expect(409);
      expect(edit.body.error.message).toBe('invoices.errors.clientLocked');
    });

    it('voids with a reason (status ANULADA, facts gone) and a second void is a CONFLICT', async () => {
      const created = await create({
        lines: [{ description: 'x', projectId: 'pry_e2e', unitPrice: '100.00', ivaRate: '16' }],
      });
      expect(
        await admin.financeFact.count({ where: { invoiceId: created.body.id } }),
      ).toBeGreaterThan(0);
      const voided = await post(`/invoices/${created.body.id}/void`, {
        reason: 'Error de cliente',
      }).expect(200);
      expect(voided.body).toMatchObject({ status: 'ANULADA', voidReason: 'Error de cliente' });
      expect(await admin.financeFact.count({ where: { invoiceId: created.body.id } })).toBe(0);
      await post(`/invoices/${created.body.id}/void`, { reason: 'Otra vez' }).expect(409);
      const client = await admin.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_e2e' },
      });
      expect(client.invoicedUsd.toFixed(2)).toBe('0.00');
    });

    it('issues a draft once; a draft has no facts until then', async () => {
      const draft = await create({ isDraft: true });
      expect(draft.body.status).toBe('BORRADOR');
      expect(await admin.financeFact.count({ where: { invoiceId: draft.body.id } })).toBe(0);
      const issued = await post(`/invoices/${draft.body.id}/issue`).expect(200);
      expect(issued.body).toMatchObject({ status: 'EMITIDA', isDraft: false });
      expect(
        await admin.financeFact.count({ where: { invoiceId: draft.body.id } }),
      ).toBeGreaterThan(0);
      await post(`/invoices/${draft.body.id}/issue`).expect(409);
    });

    it('archives and restores through the trash handler; restore is refused while the number is taken', async () => {
      const first = await create();
      const archived = await post(`/invoices/${first.body.id}/archive`).expect(200);
      expect(archived.body.archivedAt).not.toBeNull();
      expect(await admin.financeFact.count({ where: { invoiceId: first.body.id } })).toBe(0);
      const search = await admin.searchEntry.findFirstOrThrow({
        where: { entityType: 'INVOICE', entityId: first.body.id },
      });
      expect(search.archived).toBe(true);

      const holder = await create();
      const refused = await post(`/invoices/${first.body.id}/restore`).expect(409);
      expect(refused.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'trash.errors.invoiceNumberTaken',
        entity: { type: 'INVOICE', id: holder.body.id },
      });
      await post(`/invoices/${holder.body.id}/archive`).expect(200);

      const handler = app.get<RestoreHandlerRegistry>(RESTORE_HANDLER_REGISTRY);
      const restored = await post(`/invoices/${first.body.id}/restore`).expect(200);
      expect(restored.body.entity).toMatchObject({
        type: 'INVOICE',
        id: first.body.id,
        label: 'KAI-0001',
      });
      expect(handler).toBeDefined();
      const back = await http()
        .get(`${BASE}/invoices/${first.body.id}`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(back.body.archivedAt).toBeNull();
      await post(`/invoices/${first.body.id}/restore`).expect(404);
    });

    it('restore refuses to over-bill an installment another invoice took meanwhile (CONFLICT installmentExceeded)', async () => {
      const first = await create({
        lines: [
          { description: 'x', installmentId: 'ins_e2e_1', unitPrice: '4000.00', ivaRate: '16' },
        ],
      });
      await post(`/invoices/${first.body.id}/archive`).expect(200);
      await create({
        invoiceNumber: 'KAI-0002',
        lines: [
          { description: 'y', installmentId: 'ins_e2e_1', unitPrice: '4000.00', ivaRate: '16' },
        ],
      });
      const refused = await post(`/invoices/${first.body.id}/restore`).expect(409);
      expect(refused.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'invoices.errors.installmentExceeded',
      });
    });
  });

  describe('lists and wizard reads', () => {
    it('filters, searches, sorts and hides archived invoices unless a trash role asks', async () => {
      const a = await create({ invoiceNumber: 'KAI-0001' });
      await create({ invoiceNumber: 'ZAF-0001', clientId: 'cli_other' });
      const c = await create({ invoiceNumber: 'KAI-0003' });
      await post(`/invoices/${c.body.id}/archive`).expect(200);

      const list = (qs: string, role: UserRole = 'OWNER') =>
        http().get(`${BASE}/invoices?${qs}`).set('Authorization', as(role)).expect(200);
      expect((await list('')).body.items).toHaveLength(2);
      expect((await list('archived=only')).body.items.map((r: { id: string }) => r.id)).toEqual([
        c.body.id,
      ]);
      expect((await list('clientId=cli_other')).body.items).toHaveLength(1);
      expect((await list('q=kai-0001')).body.items.map((r: { id: string }) => r.id)).toEqual([
        a.body.id,
      ]);
      expect((await list('status=PAGADA')).body.items).toEqual([]);
      const sorted = await list('sort=invoiceNumber:asc');
      expect(sorted.body.items.map((r: { invoiceNumber: string }) => r.invoiceNumber)).toEqual([
        'KAI-0001',
        'ZAF-0001',
      ]);
      expect(sorted.body.items[0]).toMatchObject({
        client: { id: 'cli_e2e' },
        total: '116.00',
        balance: '116.00',
        daysOverdue: 0,
        hasPartialPayment: false,
        projects: [],
      });
      expect(sorted.body).toMatchObject({ total: 2, page: 1 });
      await http()
        .get(`${BASE}/invoices?sort=color:asc`)
        .set('Authorization', as('OWNER'))
        .expect(422);
    });

    it('registers the INVOICE tag target and note target, and the facet filters by tag', async () => {
      const created = await create();
      const tag = await admin.tag.create({ data: { name: 'e2e-tag', color: '#112233' } });
      const resolver = app
        .get<TaggableTargetRegistry>(TAGGABLE_TARGET_REGISTRY)
        .resolverFor('INVOICE');
      expect(resolver.resource).toBe('invoice');
      expect(await resolver.resolve(created.body.id)).toEqual({
        label: 'KAI-0001',
        clientId: 'cli_e2e',
      });
      expect(await resolver.resolve('nope')).toBeNull();
      const refs = await app
        .get(NoteLinkTargetRegistry)
        .requireLive([{ entityType: 'INVOICE', entityId: created.body.id }], () => 'links');
      expect(refs[0]).toMatchObject({ type: 'INVOICE', id: created.body.id, code: 'FAC-0001' });
      await admin.tagAssignment.create({ data: { tagId: tag.id, invoiceId: created.body.id } });
      const tagged = await http()
        .get(`${BASE}/invoices?tagId=${tag.id}`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(tagged.body.items.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
    });

    it('lists the open invoices of a client for the payment form', async () => {
      const a = await create({ invoiceNumber: 'A', dueDate: dayOffset(20) });
      const b = await create({ invoiceNumber: 'B', dueDate: dayOffset(10) });
      await create({ invoiceNumber: 'C', isDraft: true });
      const open = await http()
        .get(`${BASE}/clients/cli_e2e/open-invoices`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(open.body.map((r: { id: string }) => r.id)).toEqual([b.body.id, a.body.id]);
      expect(open.body[0]).toMatchObject({
        currency: 'USD',
        usdRate: '1',
        receivable: '116.00',
        balance: '116.00',
        status: 'EMITIDA',
      });
      await http()
        .get(`${BASE}/clients/cli_nope/open-invoices`)
        .set('Authorization', as('OWNER'))
        .expect(404);
    });
  });

  describe('permissions (PRD §4.3, C13)', () => {
    it('Member and Viewer get 403 on every invoice route; the Admin may read and write', async () => {
      const created = await create();
      const id = created.body.id;
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        const auth = as(role);
        await http().get(`${BASE}/invoices`).set('Authorization', auth).expect(403);
        await http().get(`${BASE}/invoices/${id}`).set('Authorization', auth).expect(403);
        await http().post(`${BASE}/invoices`).set('Authorization', auth).send(body()).expect(403);
        await http()
          .patch(`${BASE}/invoices/${id}`)
          .set('Authorization', auth)
          .send(body())
          .expect(403);
        await http()
          .put(`${BASE}/invoices/${id}/file`)
          .set('Authorization', auth)
          .send({ fileId: null })
          .expect(403);
        for (const action of ['issue', 'void', 'archive', 'restore']) {
          await http()
            .post(`${BASE}/invoices/${id}/${action}`)
            .set('Authorization', auth)
            .send({ reason: 'x' })
            .expect(403);
        }
        await http()
          .get(`${BASE}/clients/cli_e2e/billable-installments`)
          .set('Authorization', auth)
          .expect(403);
        await http()
          .get(`${BASE}/clients/cli_e2e/open-invoices`)
          .set('Authorization', auth)
          .expect(403);
      }
      await http().get(`${BASE}/invoices/${id}`).expect(401);
      await http().get(`${BASE}/invoices`).set('Authorization', as('ADMIN')).expect(200);
      await http()
        .post(`${BASE}/invoices`)
        .set('Authorization', as('ADMIN'))
        .send(body({ invoiceNumber: 'ADM-1' }))
        .expect(201);
      await http().get(`${BASE}/invoices/inv_nope`).set('Authorization', as('OWNER')).expect(404);
    });
  });
});
