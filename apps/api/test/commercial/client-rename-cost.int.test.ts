import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { buildPaymentWorld } from '../finance/payments/int-world';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { buildWorld, ownerOf, seedClient } from './concurrency/world';

/**
 * Cost of a client rename (DT-166, PRD §14 mutation target p95 < 800 ms): a client with N invoices, N payments
 * and 50 projects, seeded by SQL. It measures the rename against the same client's edit with no rename, then
 * the same rename under concurrent payment mutations of that client. The only assertion is the unit of work's
 * 30 s budget; the numbers go to `test-output/rename-cost.json` for the package report.
 */
const SIZES = [100, 1_000, 5_000] as const;
const PROJECTS = 50;
const RENAMES_UNDER_LOAD = 6;
const PAYMENT_WORKERS = 3;
const TIMEOUT_MS = 30_000;

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const results: Record<string, unknown>[] = [];

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  mkdirSync('test-output', { recursive: true });
  writeFileSync('test-output/rename-cost.json', JSON.stringify(results, null, 2));
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};
const elapsed = async (run: () => Promise<unknown>): Promise<number> => {
  const started = performance.now();
  await run();
  return Math.round(performance.now() - started);
};

async function seedBigClient(n: number, methodId: string): Promise<void> {
  await seedClient(admin, 'cli_big');
  await admin.account.create({
    data: {
      id: 'acc_seed',
      name: 'Caja',
      type: 'BANCO_INTERNACIONAL',
      currency: 'USD',
      openingBalance: '0.00',
      openingDate: new Date('2026-01-01'),
    },
  });
  await admin.$executeRawUnsafe(`
    INSERT INTO "Project" (id, code, name, summary, status, "createdAt", "updatedAt")
    SELECT 'pry_' || lpad(g::text, 4, '0'), 'PRY-' || lpad(g::text, 4, '0'), 'Proyecto ' || g, 'Resumen',
           'PROPUESTA'::"ProjectStatus", now(), now()
    FROM generate_series(1, ${PROJECTS}) g`);
  await admin.$executeRawUnsafe(`
    INSERT INTO "ProjectClient" ("projectId", "clientId", "createdAt")
    SELECT 'pry_' || lpad(g::text, 4, '0'), 'cli_big', now() FROM generate_series(1, ${PROJECTS}) g`);
  await admin.$executeRawUnsafe(`
    INSERT INTO "Invoice" (id, code, "clientId", "invoiceNumber", "issueDate", "dueDate", currency, "usdRate",
      subtotal, "taxBase", "ivaAmount", total, receivable, "totalUsd", "receivableUsd", balance, status,
      "createdAt", "updatedAt")
    SELECT 'inv_' || lpad(g::text, 6, '0'), 'FAC-S' || lpad(g::text, 6, '0'), 'cli_big', 'N-' || g,
           DATE '2026-09-01', DATE '2026-12-30', 'USD', 1, 100, 100, 0, 100, 100, 100, 100, 100,
           'EMITIDA'::"InvoiceStatus", now(), now()
    FROM generate_series(1, ${n}) g`);
  await admin.$executeRawUnsafe(`
    INSERT INTO "Payment" (id, code, "clientId", date, "accountId", "methodId", currency, amount, "netCredited",
      allocatable, unallocated, "usdRate", "amountUsd", reference, status, "createdAt", "updatedAt")
    SELECT 'pay_' || lpad(g::text, 6, '0'), 'PAG-S' || lpad(g::text, 6, '0'), 'cli_big', DATE '2026-10-01',
           'acc_seed', '${methodId}', 'USD', 100, 100, 100, 100, 1, 100, 'REF-' || g,
           'CONFIRMADO'::"PaymentStatus", now(), now()
    FROM generate_series(1, ${n}) g`);
  const entry = (type: string, table: string, prefix: string, count: number, subtitle: boolean) =>
    admin.$executeRawUnsafe(`
      INSERT INTO "SearchEntry" (id, "entityType", "entityId", code, title, subtitle, body, status, archived,
        "updatedAt")
      SELECT 'se_${prefix}_' || g, '${type}'::"EntityType", t.id, t.code, t.code,
             ${subtitle ? "'Cliente cli_big'" : 'NULL'}, NULL, NULL, false, now()
      FROM (SELECT id, code, row_number() OVER (ORDER BY id) AS g FROM "${table}") t
      WHERE t.g <= ${count}
      ON CONFLICT DO NOTHING`);
  await entry('INVOICE', 'Invoice', 'inv', n, true);
  await entry('PAYMENT', 'Payment', 'pay', n, true);
  await admin.$executeRawUnsafe(`
    INSERT INTO "SearchEntry" (id, "entityType", "entityId", code, title, subtitle, body, status, archived,
      "updatedAt")
    SELECT 'se_pry_' || id, 'PROJECT'::"EntityType", id, code, name, 'Cliente cli_big', 'Cliente cli_big C.A.',
           'PROPUESTA', false, now()
    FROM "Project"`);
  await admin.$executeRawUnsafe(`
    INSERT INTO "SearchEntry" (id, "entityType", "entityId", code, title, subtitle, body, status, archived,
      "updatedAt")
    SELECT 'se_cli_big', 'CLIENT'::"EntityType", id, code, "tradeName", "legalName", "taxId", 'PROSPECTO',
           false, now() FROM "Client" WHERE id = 'cli_big'`);
}

async function renameInput(tradeName: string, address = 'Av. Principal') {
  const row = await admin.client.findUniqueOrThrow({ where: { id: 'cli_big' } });
  return {
    id: 'cli_big',
    kind: row.kind,
    tradeName,
    legalName: row.legalName,
    taxId: row.taxId,
    country: row.country,
    address,
    phone: row.phone,
    tagIds: [],
  };
}

describe('client rename cost (DT-166)', () => {
  for (const n of SIZES) {
    it(`a client with ${n} invoices, ${n} payments and ${PROJECTS} projects`, async () => {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      const methodId = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } }))
        .id;
      await seedBigClient(n, methodId);
      const entriesBefore = await admin.searchEntry.count();

      let attempts = 0;
      const world = buildWorld(service, {
        dependents: (dependents) => ({
          relabelClient: (clientId, label) => {
            attempts += 1;
            return dependents.relabelClient(clientId, label);
          },
        }),
      });

      // Baseline: the same client edited without a rename (and a warm-up run first).
      await world.updateClient.execute(caller, await renameInput('Cliente cli_big', 'Warm 0'));
      const baselineRuns: number[] = [];
      for (let i = 1; i <= 3; i++) {
        const input = await renameInput('Cliente cli_big', `Direccion ${i}`);
        baselineRuns.push(await elapsed(() => world.updateClient.execute(caller, input)));
      }
      expect(attempts).toBe(0);

      // Rename alone.
      const renameRuns: number[] = [];
      for (let i = 1; i <= 3; i++) {
        const input = await renameInput(`Cliente Renombrado ${i}`);
        renameRuns.push(await elapsed(() => world.updateClient.execute(caller, input)));
      }
      const renamed = await admin.searchEntry.count({
        where: { subtitle: 'Cliente Renombrado 3' },
      });
      const rowsPerRename = await admin.searchEntry.count({
        where: { OR: [{ subtitle: 'Cliente Renombrado 3' }, { title: 'Cliente Renombrado 3' }] },
      });

      // The same rename while payments of the client are being mutated.
      const attemptsAlone = attempts;
      let running = true;
      const mutationMs: number[] = [];
      const mutationOutcomes: Record<string, number> = {};
      let reference = 0;
      const workers = Array.from({ length: PAYMENT_WORKERS }, async (_, index) => {
        const payments = buildPaymentWorld(service);
        while (running) {
          const started = performance.now();
          try {
            await payments.createPayment.execute(
              caller as CurrentUser,
              {
                clientId: 'cli_big',
                date: '2026-10-05',
                accountId: 'acc_seed',
                methodId,
                currency: 'USD',
                amount: '10.00',
                igtfAmount: '0.00',
                feeAmount: '0.00',
                usdRate: '1',
                reference: `LOAD-${index}-${(reference += 1)}`,
              } as never,
            );
            mutationOutcomes.ok = (mutationOutcomes.ok ?? 0) + 1;
          } catch (error) {
            const code = (error as { code?: string }).code ?? 'ERROR';
            mutationOutcomes[code] = (mutationOutcomes[code] ?? 0) + 1;
          }
          mutationMs.push(Math.round(performance.now() - started));
        }
      });

      let maxWaitMs = 0;
      let waitSamples = 0;
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          const rows = await admin.$queryRaw<{ waited: number }[]>`
            SELECT COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000, 0)::float8 AS waited
            FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query ILIKE '%FOR UPDATE%'`;
          if (rows.length > 0) waitSamples += 1;
          for (const row of rows) maxWaitMs = Math.max(maxWaitMs, Math.round(row.waited));
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      })();

      const underLoad: { ms: number; outcome: string; attempts: number }[] = [];
      for (let i = 1; i <= RENAMES_UNDER_LOAD; i++) {
        const input = await renameInput(`Cliente Bajo Carga ${i}`);
        const before = attempts;
        const started = performance.now();
        let outcome = 'ok';
        try {
          await world.updateClient.execute(caller, input);
        } catch (error) {
          outcome = (error as { code?: string }).code ?? 'ERROR';
        }
        underLoad.push({
          ms: Math.round(performance.now() - started),
          outcome,
          attempts: attempts - before,
        });
      }
      running = false;
      await Promise.all(workers);
      sampling = false;
      await sampler;

      const loadMs = underLoad.map((run) => run.ms);
      results.push({
        invoices: n,
        payments: n,
        projects: PROJECTS,
        searchEntriesBefore: entriesBefore,
        baselineEditMs: baselineRuns,
        renameMs: renameRuns,
        renameRowsWritten: { dependantsRelabelled: renamed, ownAndRelabelled: rowsPerRename },
        attemptsAloneForThreeRenames: attemptsAlone,
        underLoad: {
          renameMs: loadMs,
          p95Ms: percentile(loadMs, 95),
          outcomes: underLoad.map((run) => run.outcome),
          attempts: underLoad.map((run) => run.attempts),
          conflictRate:
            underLoad.filter((run) => run.outcome === 'CONFLICT').length / underLoad.length,
          paymentMutations: mutationOutcomes,
          paymentMutationP95Ms: percentile(mutationMs, 95),
          clientRowWaitMsMax: maxWaitMs,
          clientRowWaitSamples10ms: waitSamples,
        },
      });

      expect(Math.max(...renameRuns, ...loadMs)).toBeLessThan(TIMEOUT_MS);
    }, 280_000);
  }
});
