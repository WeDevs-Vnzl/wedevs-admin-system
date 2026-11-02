import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/modules/jobs/interface/jobs/maintenance.processor';
import { HISTORY, jobOptions, SCHEDULES } from '../../src/modules/jobs/interface/jobs/schedules';

describe('dispatch', () => {
  const handlers = {
    'daily-maintenance': { execute: () => Promise.resolve('daily') },
    retention: { execute: () => Promise.resolve('retention') },
    'cleanup-files': { execute: () => Promise.resolve('cleanup') },
  };

  it.each([
    ['daily-maintenance', 'daily'],
    ['retention', 'retention'],
    ['cleanup-files', 'cleanup'],
  ])('routes %s to its handler', async (name, expected) => {
    await expect(dispatch(handlers, name)).resolves.toBe(expected);
  });

  it('fails an unknown job instead of ignoring it', async () => {
    await expect(dispatch(handlers, 'recompute-all')).rejects.toThrow(
      'Unknown maintenance job: recompute-all',
    );
    await expect(dispatch(handlers, 'toString')).rejects.toThrow('Unknown maintenance job');
  });
});

describe('schedules (A5)', () => {
  it('lists exactly the three scheduled jobs, staggered, none of the unscheduled ones', () => {
    expect(SCHEDULES).toEqual([
      { name: 'daily-maintenance', pattern: '0 10 * * *' },
      { name: 'retention', pattern: '30 10 * * *' },
      { name: 'cleanup-files', pattern: '45 10 * * *' },
    ]);
  });

  it('retries three times with exponential backoff and keeps a bounded history', () => {
    expect(jobOptions({ attempts: 3, backoffDelayMs: 60_000 })).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      ...HISTORY,
    });
  });
});
