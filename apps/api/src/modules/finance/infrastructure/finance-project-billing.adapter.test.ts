import { describe, expect, it } from 'vitest';
import type { RowLockSet, RowLocksPort } from '../../../shared/application/ports/row-locks.port';
import { NotFoundError } from '../../../shared/domain/domain-error';
import type { ProjectBillingApi } from '../application/use-cases/billing/project-billing.api';
import {
  FinanceProjectBilling,
  type ProjectClientsLookup,
} from './finance-project-billing.adapter';

function build(over: { clientIds?: readonly string[] | null } = {}) {
  const events: string[] = [];
  const lockCalls: RowLockSet[] = [];
  const locks: RowLocksPort = {
    lock: async (set) => {
      events.push('lock');
      lockCalls.push(set);
    },
  };
  const api = {
    hasActiveBilling: async () => true,
    hasBillingPlan: async () => false,
    hasActiveRecurringCharge: async () => true,
    lockSet: async () => ({ RecurringCharge: ['rc_1'], BillingInstallment: ['ins_2', 'ins_1'] }),
    cancelForProject: async () => {
      events.push('cancel');
      return { installments: 2, recurringCharges: 1 };
    },
  } satisfies Pick<
    ProjectBillingApi,
    | 'hasActiveBilling'
    | 'hasBillingPlan'
    | 'hasActiveRecurringCharge'
    | 'lockSet'
    | 'cancelForProject'
  >;
  const projects: ProjectClientsLookup = {
    liveProject: async () =>
      over.clientIds === null ? null : { clientIds: over.clientIds ?? ['cli_a', 'cli_b'] },
  };
  return { adapter: new FinanceProjectBilling(api, projects, locks), events, lockCalls };
}

describe('FinanceProjectBilling (ProjectBillingPort over finance)', () => {
  it('answers the three reads from the billing API', async () => {
    const { adapter } = build();
    expect(await adapter.hasActiveBilling('pry_1')).toBe(true);
    expect(await adapter.hasBillingPlan('pry_1')).toBe(false);
    expect(await adapter.hasActiveRecurringCharge('pry_1')).toBe(true);
  });

  it('cancels after one lock call: the project, its clients and the billing rows (Q-BE3-1)', async () => {
    const { adapter, events, lockCalls } = build();
    const result = await adapter.cancelForProject('pry_1', {
      cancelPendingInstallments: true,
      finishRecurringCharges: true,
    });

    expect(result).toEqual({ installments: 2, recurringCharges: 1 });
    expect(events).toEqual(['lock', 'cancel']);
    expect(lockCalls).toEqual([
      {
        Project: ['pry_1'],
        Client: ['cli_a', 'cli_b'],
        RecurringCharge: ['rc_1'],
        BillingInstallment: ['ins_2', 'ins_1'],
      },
    ]);
  });

  it('refuses a project that is not live without locking or cancelling', async () => {
    const { adapter, events } = build({ clientIds: null });
    await expect(
      adapter.cancelForProject('pry_x', {
        cancelPendingInstallments: true,
        finishRecurringCharges: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(events).toEqual([]);
  });
});
