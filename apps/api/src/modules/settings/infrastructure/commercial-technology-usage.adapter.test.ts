import { describe, expect, it, vi } from 'vitest';
import type { TechnologyUsageQueries } from '../../commercial/application/technology-usage.queries';
import { CommercialTechnologyUsageAdapter } from './commercial-technology-usage.adapter';

function queries() {
  return {
    countLiveProjects: vi.fn(async (_id: string) => 3),
    detachFromArchivedProjects: vi.fn(async (_id: string) => undefined),
  } satisfies Pick<TechnologyUsageQueries, 'countLiveProjects' | 'detachFromArchivedProjects'>;
}

describe('CommercialTechnologyUsageAdapter', () => {
  it('answers the live-project count through commercial queries', async () => {
    const target = queries();
    const adapter = new CommercialTechnologyUsageAdapter(
      () => target as unknown as TechnologyUsageQueries,
    );
    await expect(adapter.countLiveProjects('tec_1')).resolves.toBe(3);
    expect(target.countLiveProjects).toHaveBeenCalledWith('tec_1');
  });

  it('detaches the technology from archived projects through commercial queries', async () => {
    const target = queries();
    const adapter = new CommercialTechnologyUsageAdapter(
      () => target as unknown as TechnologyUsageQueries,
    );
    await adapter.detachFromArchivedProjects('tec_1');
    expect(target.detachFromArchivedProjects).toHaveBeenCalledWith('tec_1');
  });

  it('resolves the queries on first use, never at construction (the module graph is circular)', async () => {
    const target = queries();
    const resolve = vi.fn(() => target as unknown as TechnologyUsageQueries);
    const adapter = new CommercialTechnologyUsageAdapter(resolve);
    expect(resolve).not.toHaveBeenCalled();
    await adapter.countLiveProjects('tec_1');
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
