import type { Actor } from '../../../../src/shared/application/actor';
import type { CurrentUser } from '../../../../src/shared/application/current-user';
import type { DateOnly } from '../../../../src/shared/domain/business-date';
import type { Rng } from './rng';
import type { World } from './world';

export type Mode = 'valid' | 'refused';
export type AnyActor = CurrentUser | Actor;

/** One call of a use case: `run` is the well-formed attempt, `bad` an attempt the use case must refuse. */
export interface Plan {
  readonly run: (actor: AnyActor) => Promise<unknown>;
  readonly bad?: (() => Promise<unknown>) | undefined;
  /** Human-readable input, quoted in a failure message. */
  readonly describe: string;
}

export interface Ctx {
  readonly world: World;
  readonly rng: Rng;
  readonly today: DateOnly;
  /** Reference data seeded once. */
  readonly refs: { readonly methods: Record<string, string>; readonly categoryId: string };
  /** A counter for unique invoice numbers and references. */
  nextNumber(): number;
}

export interface Operation {
  readonly name: string;
  /** SYSTEM steps (jobs): the valid attempt runs as the system actor, the refused one as the owner. */
  readonly system?: boolean;
  /** The use case has no refused path (a job step without input or actor check). */
  readonly validOnly?: boolean;
  /** A rate rewrite: nothing but the rate table may move (C16). */
  readonly rateRewrite?: boolean;
  /** `null` when the current state has nothing for this operation to act on. */
  readonly plan: (ctx: Ctx) => Promise<Plan | null>;
}

const DAY = 86_400_000;

export function addDays(date: DateOnly, days: number): DateOnly {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of a Date column. */
export function dayOf(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

/** Currency to its usual rate scale: USD is 1, the others are market-like and positive. */
export function rateFor(ctx: Ctx, currency: string): string {
  if (currency === 'USD') return '1';
  if (currency === 'VES') return ctx.rng.money(35, 60);
  return `0.${ctx.rng.int(80, 99)}`;
}

export const CURRENCIES = ['USD', 'VES', 'EUR'] as const;
