import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/shared/application/actor';
import {
  DailyMaintenance,
  type DailyMaintenanceSteps,
} from '../../src/modules/jobs/application/daily-maintenance';
import { JobRunner, type JobFailureLogger } from '../../src/modules/jobs/application/job-runner';
import { RunExchangeSync } from '../../src/modules/jobs/application/run-exchange-sync';
import {
  EXCHANGE_SYNC_SCHEDULE,
  SCHEDULES,
  schedulesFor,
} from '../../src/modules/jobs/interface/jobs/schedules';
import { InMemoryActivityLog } from '../support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../support/fakes/in-memory-unit-of-work';

function world() {
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const failures: { job: string; step: string; error: unknown }[] = [];
  const logger: JobFailureLogger = { stepFailed: (context) => failures.push(context) };
  return { activity, failures, runner: new JobRunner(uow, activity, logger) };
}

const calls: string[] = [];
const step = (name: string, result: object) => ({
  execute: async (actor: unknown) => {
    expect(actor).toBe(SYSTEM_ACTOR);
    calls.push(name);
    return result;
  },
});
const baseSteps = () => ({
  markOverdueInvoices: step('overdue', { updated: 0, skippedIds: [] }),
  markExpiredDocuments: step('documents', { updated: 0, skippedIds: [] }),
  generateRecurringInstallments: step('installments', { created: 0, skippedIds: [] }),
  generateRecurringExpenses: step('expenses', { created: 0, skippedIds: [] }),
  markExpiredShareLinks: step('shares', { updated: 0, skippedIds: [] }),
});

describe('DailyMaintenance: payment-link step (DT-196)', () => {
  it('runs the link deactivation last, after every other step, and summarizes its counts', async () => {
    calls.length = 0;
    const { runner, activity } = world();
    const links = step('links', {
      deactivated: ['a', 'b'],
      skippedInvoiceIds: ['inv_1'],
      providerFailures: ['b'],
    });

    const result = await new DailyMaintenance(runner, {
      ...baseSteps(),
      deactivatePaymentLinks: links,
    } as unknown as DailyMaintenanceSteps).execute();

    expect(calls).toEqual(['overdue', 'documents', 'installments', 'expenses', 'shares', 'links']);
    expect(result.steps.at(-1)).toEqual({
      name: 'deactivate-payment-links',
      status: 'ok',
      counts: { deactivated: 2, skipped: 1, providerFailures: 1 },
    });
    expect(activity.entries.at(-1)).toMatchObject({
      actor: SYSTEM_ACTOR,
      action: 'SYSTEM_JOB',
      entityId: 'deactivate-payment-links',
      metadata: { job: 'daily-maintenance', deactivated: 2, skipped: 1, providerFailures: 1 },
    });
  });

  it('is a no-op when Stripe is off: the step is not wired and the other five run unchanged', async () => {
    calls.length = 0;
    const { runner } = world();
    const result = await new DailyMaintenance(
      runner,
      baseSteps() as unknown as DailyMaintenanceSteps,
    ).execute();
    expect(result.steps.map((s) => s.name)).not.toContain('deactivate-payment-links');
    expect(calls).toEqual(['overdue', 'documents', 'installments', 'expenses', 'shares']);
  });

  it('a failing link step fails the job after the earlier steps ran', async () => {
    const { runner, failures } = world();
    const links = {
      execute: async () => {
        throw new Error('db');
      },
    };
    await expect(
      new DailyMaintenance(runner, {
        ...baseSteps(),
        deactivatePaymentLinks: links,
      } as unknown as DailyMaintenanceSteps).execute(),
    ).rejects.toMatchObject({ failedSteps: ['deactivate-payment-links'] });
    expect(failures).toHaveLength(1);
  });
});

describe('RunExchangeSync (DT-184)', () => {
  it('runs the sync as SYSTEM and summarizes its counts under the exchange-sync job', async () => {
    const { runner, activity } = world();
    const sync = step('sync', { balances: 2, deposits: 3, recorded: 1, duplicates: 2 }) as never;

    const result = await new RunExchangeSync(runner, sync).execute();

    expect(result).toEqual({
      job: 'exchange-sync',
      steps: [
        {
          name: 'sync-exchange-account',
          status: 'ok',
          counts: { balances: 2, deposits: 3, recorded: 1, duplicates: 2 },
        },
      ],
    });
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      action: 'SYSTEM_JOB',
      entityId: 'sync-exchange-account',
    });
  });

  it('fails the job when the exchange fails, so the queue retries it', async () => {
    const { runner } = world();
    const down = {
      execute: async () => {
        throw new Error('RATE_LIMITED');
      },
    };
    await expect(new RunExchangeSync(runner, down).execute()).rejects.toMatchObject({
      job: 'exchange-sync',
      failedSteps: ['sync-exchange-account'],
    });
  });
});

describe('schedulesFor', () => {
  it('registers exchange-sync only when Binance is configured, daily and in UTC', () => {
    expect(schedulesFor({ exchangeSync: false })).toEqual(SCHEDULES);
    expect(schedulesFor({ exchangeSync: true })).toEqual([...SCHEDULES, EXCHANGE_SYNC_SCHEDULE]);
    expect(EXCHANGE_SYNC_SCHEDULE).toEqual({ name: 'exchange-sync', pattern: '0 11 * * *' });
  });

  it('keeps the existing schedules exactly as they were', () => {
    expect(SCHEDULES.map((s) => s.name)).toEqual([
      'daily-maintenance',
      'retention',
      'cleanup-files',
    ]);
  });
});
