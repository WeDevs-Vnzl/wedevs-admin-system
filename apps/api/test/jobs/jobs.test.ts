import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/shared/application/actor';
import {
  DailyMaintenance,
  type DailyMaintenanceSteps,
} from '../../src/modules/jobs/application/daily-maintenance';
import {
  JobFailedError,
  JobRunner,
  type JobFailureLogger,
} from '../../src/modules/jobs/application/job-runner';
import { RunCleanupFiles } from '../../src/modules/jobs/application/run-cleanup-files';
import { RunRetention } from '../../src/modules/jobs/application/run-retention';
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
function steps(overrides: Partial<Record<keyof DailyMaintenanceSteps, () => Promise<never>>> = {}) {
  const make = (name: keyof DailyMaintenanceSteps, result: object) => ({
    execute: (actor: unknown) => {
      expect(actor).toBe(SYSTEM_ACTOR);
      calls.push(name);
      return (overrides[name] ?? (() => Promise.resolve(result)))();
    },
  });
  return {
    markOverdueInvoices: make('markOverdueInvoices', { updated: 2, skippedIds: ['a'] }),
    markExpiredDocuments: make('markExpiredDocuments', { updated: 1, skippedIds: [] }),
    generateRecurringInstallments: make('generateRecurringInstallments', {
      created: 3,
      skippedIds: [],
    }),
    generateRecurringExpenses: make('generateRecurringExpenses', { created: 4, skippedIds: [] }),
    markExpiredShareLinks: make('markExpiredShareLinks', { updated: 5, skippedIds: [] }),
  } as unknown as DailyMaintenanceSteps;
}

describe('DailyMaintenance', () => {
  it('runs the steps in the PRD order and writes one summary entry per step', async () => {
    calls.length = 0;
    const { runner, activity } = world();

    const result = await new DailyMaintenance(runner, steps()).execute();

    expect(calls).toEqual([
      'markOverdueInvoices',
      'markExpiredDocuments',
      'generateRecurringInstallments',
      'generateRecurringExpenses',
      'markExpiredShareLinks',
    ]);
    expect(result.steps.map((s) => s.name)).toEqual([
      'mark-overdue-invoices',
      'mark-expired-documents',
      'generate-recurring-installments',
      'generate-recurring-expenses',
      'mark-expired-share-links',
    ]);
    expect(activity.entries).toHaveLength(5);
    expect(activity.entries[0]).toMatchObject({
      actor: SYSTEM_ACTOR,
      action: 'SYSTEM_JOB',
      entityType: 'SETTING',
      entityId: 'mark-overdue-invoices',
      metadata: { job: 'daily-maintenance', updated: 2, skipped: 1 },
    });
    expect(activity.entries[2]?.metadata).toMatchObject({ created: 3, skipped: 0 });
  });

  it('keeps running after a failing step, then fails the job naming the step', async () => {
    calls.length = 0;
    const { runner, activity, failures } = world();
    const boom = new Error('db down');
    const failing = steps({ markExpiredDocuments: () => Promise.reject(boom) });

    const run = new DailyMaintenance(runner, failing).execute();

    await expect(run).rejects.toThrow(JobFailedError);
    await expect(run).rejects.toMatchObject({
      job: 'daily-maintenance',
      failedSteps: ['mark-expired-documents'],
      message: 'Job daily-maintenance failed at: mark-expired-documents',
    });
    expect(calls.slice(0, 5)).toEqual([
      'markOverdueInvoices',
      'markExpiredDocuments',
      'generateRecurringInstallments',
      'generateRecurringExpenses',
      'markExpiredShareLinks',
    ]);
    expect(failures).toEqual([
      { job: 'daily-maintenance', step: 'mark-expired-documents', error: boom },
    ]);
    // The failed step leaves no summary; the other four do.
    expect(activity.entries.map((e) => e.entityId)).toEqual([
      'mark-overdue-invoices',
      'generate-recurring-installments',
      'generate-recurring-expenses',
      'mark-expired-share-links',
    ]);
  });

  it('lists every failed step when several fail', async () => {
    const { runner } = world();
    const failing = steps({
      markOverdueInvoices: () => Promise.reject(new Error('a')),
      markExpiredShareLinks: () => Promise.reject(new Error('b')),
    });

    await expect(new DailyMaintenance(runner, failing).execute()).rejects.toMatchObject({
      failedSteps: ['mark-overdue-invoices', 'mark-expired-share-links'],
    });
  });
});

describe('RunRetention (A4 against the purge summary)', () => {
  it('adds the runner summary when the purge deleted nothing', async () => {
    const { runner, activity } = world();

    await new RunRetention(runner, {
      execute: () => Promise.resolve({ deleted: 0, batches: 1 }),
    }).execute();

    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      entityId: 'purge-share-access-log',
      metadata: { job: 'retention', deleted: 0, batches: 1 },
    });
  });

  it('writes nothing more when the purge already wrote its own entry', async () => {
    const { runner, activity } = world();

    const result = await new RunRetention(runner, {
      execute: () => Promise.resolve({ deleted: 7, batches: 1 }),
    }).execute();

    expect(activity.entries).toHaveLength(0);
    expect(result.steps[0]).toMatchObject({ status: 'ok', counts: { deleted: 7, batches: 1 } });
  });

  it('fails the job when the purge throws', async () => {
    const { runner } = world();

    await expect(
      new RunRetention(runner, { execute: () => Promise.reject(new Error('x')) }).execute(),
    ).rejects.toMatchObject({ job: 'retention', failedSteps: ['purge-share-access-log'] });
  });
});

describe('RunCleanupFiles', () => {
  it('summarizes the run and does not fail on files left for the next run', async () => {
    const { runner, activity } = world();

    await new RunCleanupFiles(runner, {
      execute: () => Promise.resolve({ deleted: 2, skipped: 1, failed: 1 }),
    }).execute();

    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      entityId: 'cleanup-files',
      metadata: { job: 'cleanup-files', deleted: 2, skipped: 1, failed: 1 },
    });
  });
});
