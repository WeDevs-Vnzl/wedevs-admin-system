import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mode, Operation } from './scenario/ops-base';
import { BILLING } from './scenario/ops-billing';
import { EXPENSES } from './scenario/ops-expenses';
import { INVOICES } from './scenario/ops-invoices';
import { PAYMENTS } from './scenario/ops-payments';
import { RATES_AND_ACCOUNTS } from './scenario/ops-rates-accounts';
import { Rng } from './scenario/rng';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { addDays } from './scenario/ops-base';
import { diffSnapshots, Scenario } from './scenario/runner';
import { stateOf, takeSnapshot } from './scenario/snapshot';
import { seedBase } from './scenario/seed';
import { bootWorld, type World } from './scenario/world';

/**
 * Exit criterion of BE-3: after each step of a seeded scenario that drives every money mutation use case,
 * valid and refused, the incremental read models (facts, client and project metrics, account balances, invoice
 * and payment caches, installment statuses, recurring USD snapshots) equal what `RecomputeAll` rebuilds from
 * the sources; a refused step changes nothing; a rate rewrite moves no snapshot (C16); `projectCount` and
 * `lastActivityAt` survive the rebuild. A failure message carries the seed, the step, the use case and its
 * input, so the exact run replays with the same seed.
 */
vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 });

const SEED = 20260310;
const RANDOM_STEPS = 240;
const OPERATIONS: readonly Operation[] = [
  ...RATES_AND_ACCOUNTS,
  ...BILLING,
  ...EXPENSES,
  ...INVOICES,
  ...PAYMENTS,
];
/** The write-heavy half of the pool, drawn twice as often so the state grows before it is edited. */
const WEIGHTED: readonly Operation[] = [
  ...OPERATIONS,
  ...[...BILLING, ...EXPENSES, ...INVOICES, ...PAYMENTS].filter(
    (op) => op.name.startsWith('create') || op.name === 'allocatePayment',
  ),
];

describe('read models equal recompute-all after every money mutation', () => {
  let world: World;
  let scenario: Scenario;
  const startedAt = Date.now();

  beforeAll(async () => {
    world = await bootWorld();
    scenario = new Scenario(world, new Rng(SEED), await seedBase(world));
  });

  afterAll(async () => {
    await world.close();
  });

  it(`holds for seed ${SEED} over ${RANDOM_STEPS} random steps and a coverage sweep`, async () => {
    const picker = new Rng(SEED ^ 0x9e3779b9);
    while (scenario.records.filter((r) => r.outcome !== 'skipped').length < RANDOM_STEPS) {
      const mode: Mode = picker.chance(0.7) ? 'valid' : 'refused';
      await scenario.run(picker.pick(WEIGHTED), mode);
    }

    // Coverage sweep: every use case must have succeeded once and been refused once.
    const counts = (op: Operation, outcome: 'ok' | 'refused') =>
      scenario.records.filter((r) => r.op === op.name && r.outcome === outcome).length;
    for (const op of OPERATIONS) {
      for (let tries = 0; tries < 40 && counts(op, 'ok') === 0; tries += 1) {
        await scenario.run(op, 'valid');
      }
      for (let tries = 0; tries < 40 && !op.validOnly && counts(op, 'refused') === 0; tries += 1) {
        await scenario.run(op, 'refused');
      }
    }

    const executed = scenario.records.filter((r) => r.outcome !== 'skipped');
    const reasons = (op: Operation) =>
      [
        ...new Set(
          scenario.records
            .filter((r) => r.op === op.name && r.outcome === 'refused')
            .map((r) => r.detail),
        ),
      ]
        .slice(0, 4)
        .join(' | ');
    const table = OPERATIONS.map(
      (op) =>
        `${op.name.padEnd(34)} ok=${counts(op, 'ok')} refused=${counts(op, 'refused')}  ${reasons(op)}`,
    );
    console.log(
      `seed=${SEED} steps=${executed.length} duration=${Math.round((Date.now() - startedAt) / 1000)}s\n${table.join('\n')}`,
    );

    for (const op of OPERATIONS) {
      expect(counts(op, 'ok'), `${op.name} never succeeded`).toBeGreaterThan(0);
      if (!op.validOnly)
        expect(counts(op, 'refused'), `${op.name} was never refused`).toBeGreaterThan(0);
    }

    // The scenario must produce real money data, otherwise equality over empty tables proves nothing.
    const { db } = world;
    expect(await db.financeFact.count()).toBeGreaterThan(20);
    expect(await db.invoice.count({ where: { status: 'PAGADA' } })).toBeGreaterThan(0);
    expect(await db.paymentAllocation.count()).toBeGreaterThan(0);
    expect(await db.invoice.count({ where: { status: 'VENCIDA' } })).toBeGreaterThan(0);
  });
  /** PRD §9.4 has no archived branch: the overdue step and `RecomputeAll` both mark an archived open invoice. */
  it('archived open invoice: the overdue step and recompute-all agree on its status', async () => {
    const { uc, owner, clock } = world;
    const today = world.today();
    const created = await uc.createInvoice.execute(owner, {
      clientId: 'cli_a',
      invoiceNumber: 'DRIFT-1',
      issueDate: today,
      dueDate: addDays(today, 10),
      currency: 'USD',
      usdRate: '1',
      lines: [{ description: 'Servicio', projectId: null, unitPrice: '100.00', ivaRate: null }],
    });
    await uc.archiveInvoice.execute(owner, { id: created.id });
    clock.advance(20 * 86_400_000);
    await uc.markOverdue.execute(SYSTEM_ACTOR);
    const stored = await world.db.invoice.findFirst({
      where: { id: created.id, deletedAt: undefined },
    });
    expect(stored?.status).toBe('VENCIDA');
    const incremental = await takeSnapshot(world.db);
    await world.recomputeAll.execute(SYSTEM_ACTOR);
    const rebuilt = await takeSnapshot(world.db);
    expect(diffSnapshots(stateOf(incremental), stateOf(rebuilt))).toEqual([]);
  });
});
