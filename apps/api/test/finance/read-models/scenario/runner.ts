import { SYSTEM_ACTOR } from '../../../../src/modules/finance/application/recompute-all';
import { DomainError } from '../../../../src/shared/domain/domain-error';
import type { Ctx, Mode, Operation } from './ops-base';
import { Rng } from './rng';
import { stateOf, takeSnapshot, type Snapshot } from './snapshot';
import type { World } from './world';

export type Outcome = 'ok' | 'refused' | 'skipped';

export interface StepRecord {
  readonly step: number;
  readonly op: string;
  readonly mode: Mode;
  readonly outcome: Outcome;
  readonly detail: string;
}

/** Lines present in one side of two sorted row lists only; empty when the lists are equal. */
function diffRows(label: string, expected: readonly string[], actual: readonly string[]): string[] {
  const missing = expected.filter((row) => !actual.includes(row));
  const extra = actual.filter((row) => !expected.includes(row));
  return [
    ...missing.map((row) => `${label}: expected ${row}`),
    ...extra.map((row) => `${label}: actual   ${row}`),
  ];
}

export function diffSnapshots(
  expected: Pick<Snapshot, 'state' | 'facts'>,
  actual: Pick<Snapshot, 'state' | 'facts'>,
): string[] {
  return [
    ...Object.keys(expected.state).flatMap((model) =>
      diffRows(model, expected.state[model] ?? [], actual.state[model] ?? []),
    ),
    ...diffRows('financeFact', expected.facts, actual.facts),
  ];
}

/**
 * Drives the use cases with a seeded generator. After every step the incremental state must equal the state
 * `RecomputeAll` rebuilds; a refused step must change nothing; a rate rewrite must move no snapshot (C16).
 */
export class Scenario {
  readonly records: StepRecord[] = [];
  private numbers = 0;
  private step = 0;

  constructor(
    private readonly world: World,
    private readonly rng: Rng,
    private readonly base: Pick<Ctx, 'refs'>,
  ) {}

  private ctx(): Ctx {
    return {
      world: this.world,
      rng: this.rng,
      today: this.world.today(),
      refs: this.base.refs,
      nextNumber: () => ++this.numbers,
    };
  }

  async run(op: Operation, mode: Mode): Promise<StepRecord> {
    const { world, rng } = this;
    if (mode === 'refused' && op.validOnly)
      return this.record(op, mode, 'skipped', 'no refused path');
    const plan = await op.plan(this.ctx());
    if (plan === null) return this.record(op, mode, 'skipped', 'nothing to act on');
    const before = await takeSnapshot(world.db);
    const label = `seed=${rng.seed} step=${this.step} op=${op.name} mode=${mode} input=${plan.describe}`;

    let call: () => Promise<unknown>;
    if (mode === 'valid') {
      call = () => plan.run(op.system ? SYSTEM_ACTOR : world.owner);
    } else if (plan.bad && rng.chance(0.6)) {
      call = plan.bad;
    } else {
      // Forbidden: a viewer on a user use case, a user on a SYSTEM step.
      call = () => plan.run(op.system ? world.owner : world.viewer);
    }

    let outcome: Outcome = 'ok';
    let detail = 'ok';
    try {
      await call();
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw new Error(`[${label}] unexpected non-domain failure: ${String(error)}`, {
          cause: error,
        });
      }
      outcome = 'refused';
      detail = `${error.constructor.name} ${JSON.stringify(error.fieldErrors ?? {})}`;
    }

    const after = await takeSnapshot(world.db);
    if (outcome === 'refused') {
      const moved = [
        ...diffSnapshots(stateOf(before), stateOf(after)),
        ...diffRows('rates', before.rates, after.rates),
        ...Object.entries(before.effects)
          .filter(([key, value]) => after.effects[key] !== value)
          .map(([key, value]) => `${key}: ${value} -> ${after.effects[key]}`),
      ];
      if (moved.length > 0) {
        throw new Error(`[${label}] a refused step changed state:\n${moved.join('\n')}`);
      }
    } else if (op.rateRewrite) {
      const moved = diffSnapshots(stateOf(before), stateOf(after));
      if (moved.length > 0) {
        throw new Error(`[${label}] a rate rewrite moved a snapshot (C16):\n${moved.join('\n')}`);
      }
    }

    const result = await world.recomputeAll.execute(SYSTEM_ACTOR);
    if (result.problems.length > 0) {
      throw new Error(
        `[${label}] recompute-all reported problems: ${JSON.stringify(result.problems)}`,
      );
    }
    const rebuilt = await takeSnapshot(world.db);
    const drift = diffSnapshots(stateOf(after), stateOf(rebuilt));
    if (drift.length > 0) {
      throw new Error(
        `[${label}] read models drifted from recompute-all (expected = incremental, actual = rebuilt):\n${drift.join('\n')}`,
      );
    }
    return this.record(op, mode, outcome, detail);
  }

  private record(op: Operation, mode: Mode, outcome: Outcome, detail: string): StepRecord {
    const record = { step: this.step, op: op.name, mode, outcome, detail };
    if (outcome !== 'skipped') this.step += 1;
    this.records.push(record);
    return record;
  }
}
