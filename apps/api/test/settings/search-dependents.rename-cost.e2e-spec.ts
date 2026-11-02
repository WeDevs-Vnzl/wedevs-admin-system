import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PaymentsModule } from '../../src/modules/finance/payments.module';
import { MatrixAuthorization } from '../../src/modules/identity/infrastructure/matrix-authorization';
import { DocumentTypesModule } from '../../src/modules/settings/document-types.module';
import { FinanceCatalogsModule } from '../../src/modules/settings/finance-catalogs.module';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { createTestApp } from '../support/test-app';

// Seeding 6,000 rows and renaming them takes seconds even on a quiet disk.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const BASE = '/api/v1';
const PAYMENTS = 5_000;
const DOCUMENTS = 1_000;
const RUNS = 10;
/** The unit of work's own budget, in milliseconds. */
const UOW_BUDGET_MS = 30_000;

const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] as number;
};

/**
 * Rename cost gate (X18, DT-166): a payment method held by 5,000 payments and a document type held by 1,000
 * documents are renamed through the real HTTP stack, every dependant entry rewritten in the same
 * `Serializable` unit of work. No run may reach the 30 s budget; timings are logged, because p95 against PRD §14's 800 ms is too load-dependent to assert.
 */
describe('rename cost of a catalog entry with many dependants (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  let methodId: string;
  let methodRow: { nameEn: string | null; requiresReference: boolean; suggestsIgtf: boolean };
  let typeBody: Record<string, unknown>;
  let methodName: string;
  let typeName: string;
  const authenticator = new FakeAuthenticator();

  beforeAll(async () => {
    await truncateBusinessTables(admin);
    const user = await admin.user.create({
      data: { clerkId: 'user_cost', email: 'cost@example.test', name: 'Owner', role: 'OWNER' },
    });
    token = authenticator.issue({
      userId: user.id,
      clerkId: user.clerkId,
      role: 'OWNER',
      email: user.email,
      name: 'Owner',
    });
    app = await createTestApp({
      modules: [FinanceCatalogsModule, DocumentTypesModule, PaymentsModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });

    await admin.client.create({
      data: {
        id: 'cli_cost',
        code: 'CLI-0001',
        kind: 'EMPRESA',
        tradeName: 'Kairos',
        legalName: 'Kairos C.A.',
        taxId: 'J-1',
        country: 'VE',
        address: 'Av. Principal',
        phone: '+584121234567',
      },
    });
    await admin.account.create({
      data: {
        id: 'acc_cost',
        name: 'Caja',
        type: 'BANCO_INTERNACIONAL',
        currency: 'USD',
        openingBalance: '0.00',
        openingDate: new Date('2026-01-01'),
      },
    });
    const method = await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } });
    methodId = method.id;
    methodName = method.name;
    methodRow = method;
    const type = await admin.documentType.findUniqueOrThrow({ where: { id: 'dtyp_nda' } });
    typeName = type.name;
    typeBody = {
      categoryId: type.categoryId,
      nameEn: type.nameEn,
      requiresSignature: type.requiresSignature,
      hasExpiration: type.hasExpiration,
      defaultFormat: type.defaultFormat,
      active: type.active,
    };

    const indexes = Array.from({ length: PAYMENTS }, (_, i) => i);
    for (let from = 0; from < PAYMENTS; from += 1_000) {
      const chunk = indexes.slice(from, from + 1_000);
      await admin.payment.createMany({
        data: chunk.map((i) => ({
          id: `pay_cost_${i}`,
          code: `PAG-${i + 1}`,
          clientId: 'cli_cost',
          date: new Date('2026-10-05'),
          accountId: 'acc_cost',
          methodId,
          currency: 'USD',
          amount: '100.00',
          igtfAmount: '0.00',
          feeAmount: '0.00',
          netCredited: '100.00',
          allocatable: '100.00',
          unallocated: '100.00',
          usdRate: '1',
          amountUsd: '100.00',
          status: 'CONFIRMADO' as const,
          reference: `OP-${i}`,
        })),
      });
      await admin.searchEntry.createMany({
        data: chunk.map((i) => ({
          entityType: 'PAYMENT' as const,
          entityId: `pay_cost_${i}`,
          code: `PAG-${i + 1}`,
          title: `Pago PAG-${i + 1}`,
          subtitle: 'Kairos',
          body: `OP-${i} ${methodName}`,
        })),
      });
    }
    const docs = Array.from({ length: DOCUMENTS }, (_, i) => i);
    await admin.document.createMany({
      data: docs.map((i) => ({
        id: `doc_cost_${i}`,
        code: `DOC-${i + 1}`,
        title: `Documento ${i}`,
        typeId: 'dtyp_nda',
      })),
    });
    await admin.searchEntry.createMany({
      data: docs.map((i) => ({
        entityType: 'DOCUMENT' as const,
        entityId: `doc_cost_${i}`,
        code: `DOC-${i + 1}`,
        title: `Documento ${i}`,
        subtitle: typeName,
      })),
    });
  });

  afterAll(async () => {
    await admin.paymentMethod.update({ where: { id: methodId }, data: { name: methodName } });
    await admin.documentType.update({ where: { id: 'dtyp_nda' }, data: { name: typeName } });
    await truncateBusinessTables(admin);
    await app.close();
    await admin.$disconnect();
  });

  const patch = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .patch(`${BASE}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  async function measure(rename: (name: string) => Promise<request.Response>, prefix: string) {
    const times: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const res = await rename(`${prefix} ${run}`);
      times.push(performance.now() - started);
      expect(res.status).toBe(200);
    }
    return times;
  }

  const report = (label: string, rows: number, times: number[]) =>
    process.stdout.write(
      `[rename-cost] ${label}: ${rows} entries, runs ms=${times.map((t) => t.toFixed(0)).join(',')} ` +
        `p50=${percentile(times, 0.5).toFixed(0)} p95=${percentile(times, 0.95).toFixed(0)} ` +
        `max=${Math.max(...times).toFixed(0)}\n`,
    );

  it('baseline: renames a method and a type with no dependants', async () => {
    await admin.paymentMethod.create({
      data: { id: 'pmt_cost_empty', code: 'COST_EMPTY', name: 'Vacio' },
    });
    await admin.documentType.create({
      data: { id: 'dtyp_cost_empty', name: 'Vacio', ...(typeBody as { categoryId: string }) },
    });
    const methods = await measure(
      (name) => patch('/payment-methods/pmt_cost_empty', { ...methodRow, name }),
      'Vacio',
    );
    const types = await measure(
      (name) => patch('/document-types/dtyp_cost_empty', { ...typeBody, name }),
      'Vacio',
    );
    report('baseline payment method', 0, methods);
    report('baseline document type', 0, types);
    await admin.documentType.delete({ where: { id: 'dtyp_cost_empty' } });
    await admin.paymentMethod.delete({ where: { id: 'pmt_cost_empty' } });
  });

  it(`renames a method held by ${PAYMENTS} payments within the unit of work budget`, async () => {
    const times = await measure(
      (name) => patch(`/payment-methods/${methodId}`, { ...methodRow, name }),
      'Zelle Cost',
    );
    report('payment method', PAYMENTS, times);

    const last = `Zelle Cost ${RUNS - 1}`;
    const rewritten = await admin.searchEntry.count({
      where: { entityType: 'PAYMENT', body: { endsWith: last } },
    });
    expect(rewritten).toBe(PAYMENTS);
    expect(Math.max(...times)).toBeLessThan(UOW_BUDGET_MS);
  });

  it(`renames a type held by ${DOCUMENTS} documents within the unit of work budget`, async () => {
    const times = await measure(
      (name) => patch('/document-types/dtyp_nda', { ...typeBody, name }),
      'NDA Cost',
    );
    report('document type', DOCUMENTS, times);

    const rewritten = await admin.searchEntry.count({
      where: { entityType: 'DOCUMENT', subtitle: `NDA Cost ${RUNS - 1}` },
    });
    expect(rewritten).toBe(DOCUMENTS);
    expect(Math.max(...times)).toBeLessThan(UOW_BUDGET_MS);
  });
});
