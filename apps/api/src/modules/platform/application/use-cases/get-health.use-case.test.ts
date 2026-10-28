import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../../../../test/support/fakes/fixed-clock';
import type { HealthProbePort } from '../ports/health-probe.port';
import { GetHealth } from './get-health.use-case';

describe('GetHealth', () => {
  it('reports ok with the clock time when the database answers', async () => {
    const probe: HealthProbePort = { checkDatabase: () => Promise.resolve() };
    const useCase = new GetHealth(probe, new FixedClock('2026-02-03T04:05:06.000Z'));
    await expect(useCase.execute()).resolves.toEqual({
      status: 'ok',
      database: 'up',
      time: '2026-02-03T04:05:06.000Z',
    });
  });

  it('propagates a probe failure', async () => {
    const probe: HealthProbePort = { checkDatabase: () => Promise.reject(new Error('down')) };
    const useCase = new GetHealth(probe, new FixedClock());
    await expect(useCase.execute()).rejects.toThrow('down');
  });
});
