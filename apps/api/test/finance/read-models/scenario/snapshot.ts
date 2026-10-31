import type { PrismaClient } from '../../../../src/generated/prisma/client';

type Delegate = { findMany(args?: object): Promise<object[]> };

/** Models whose rows are compared in full (timestamps `createdAt`/`updatedAt` aside). */
const STATE_MODELS = [
  'billingPlan',
  'billingInstallment',
  'recurringCharge',
  'recurringExpense',
  'invoice',
  'invoiceLine',
  'invoiceTaxLine',
  'payment',
  'paymentAllocation',
  'expense',
  'account',
  'accountTransfer',
  'accountMovement',
  'accountReconciliation',
  'clientMetrics',
  'projectMetrics',
  'sequence',
] as const;

const ZERO_METRICS = [
  'contractedUsd',
  'invoicedUsd',
  'collectedUsd',
  'toInvoiceUsd',
  'receivableUsd',
  'expensesUsd',
  'marginUsd',
  'monthlyRecurringUsd',
];

/**
 * `balanceAt` is the instant the cached balance was computed (`clock.now()`), not a value: the balance itself
 * covers every movement (`BALANCE_UNTIL`), and a rebuild stamps all accounts with the new instant.
 */
const IGNORED_KEYS = new Set(['createdAt', 'updatedAt', 'balanceAt']);

/** JSON of a row with the timestamps that legitimately move removed; Decimals and dates serialize stably. */
function normalize(row: object): string {
  const entries = Object.entries(row)
    .filter(([key]) => !IGNORED_KEYS.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

export interface Snapshot {
  /** Every read model, cache and source row the scenario touches. */
  readonly state: Record<string, string[]>;
  /** `FinanceFact` as a multiset: sorted rows without `id` and `createdAt`. */
  readonly facts: string[];
  /** Counts of append-only side effects: a refused step must add none. */
  readonly effects: Record<string, number>;
  /** The rate table, apart: a rate rewrite moves it and nothing else. */
  readonly rates: string[];
}

export async function takeSnapshot(db: PrismaClient): Promise<Snapshot> {
  const delegates = db as unknown as Record<string, Delegate>;
  const state: Record<string, string[]> = {};
  for (const model of STATE_MODELS) {
    const rows = await (delegates[model] as Delegate).findMany();
    // Tax lines are keyed by (invoice, rate) and the rebuild re-inserts them: their surrogate id is no state.
    state[model] = rows
      .map((row) => {
        if (model !== 'invoiceTaxLine') return normalize(row);
        const { id: _id, ...rest } = row as { id?: string };
        return normalize(rest);
      })
      .sort();
  }
  // A project without a `ProjectMetrics` row reads as zeros (`project-views.ts`), and only the finance writer
  // creates the row, while the rebuild writes one for every project: an absent row equals an all-zero row.
  const withMetrics = new Set((await db.projectMetrics.findMany()).map((row) => row.projectId));
  for (const { id } of await db.project.findMany({ select: { id: true } })) {
    if (withMetrics.has(id)) continue;
    state.projectMetrics?.push(
      normalize({
        projectId: id,
        ...Object.fromEntries(ZERO_METRICS.map((column) => [column, '0'])),
      }),
    );
  }
  state.projectMetrics?.sort();
  const facts = (await db.financeFact.findMany()).map(
    ({ id: _id, createdAt: _createdAt, ...rest }) => normalize(rest),
  );
  return {
    state,
    facts: facts.sort(),
    effects: {
      activityLog: await db.activityLog.count(),
      searchEntry: await db.searchEntry.count(),
    },
    rates: (await db.exchangeRate.findMany()).map(normalize).sort(),
  };
}

/** The part of a snapshot that read models are compared on (no activity counts, no rates). */
export function stateOf(snapshot: Snapshot): Pick<Snapshot, 'state' | 'facts'> {
  return { state: snapshot.state, facts: snapshot.facts };
}
