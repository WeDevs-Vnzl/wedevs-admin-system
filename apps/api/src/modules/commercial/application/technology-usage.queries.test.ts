import { describe, expect, it } from 'vitest';
import {
  NEXT_JS,
  projectRecord,
  projectWorld,
  RUST,
} from '../../../../test/commercial/projects/fakes/world';
import { TechnologyUsageQueries } from './technology-usage.queries';

function setup() {
  const w = projectWorld();
  w.projects.seed(
    projectRecord({ id: 'live1', technologyIds: [NEXT_JS.id] }),
    projectRecord({ id: 'live2', technologyIds: [NEXT_JS.id, RUST.id] }),
    projectRecord({ id: 'old', technologyIds: [NEXT_JS.id], archivedAt: new Date('2026-03-01Z') }),
  );
  return { w, queries: new TechnologyUsageQueries(w.projects) };
}

describe('TechnologyUsageQueries (HU-06 CA3, bound to settings by 4.1)', () => {
  it('counts the live projects that list the technology, archived ones excluded', async () => {
    const { queries } = setup();
    expect(await queries.countLiveProjects(NEXT_JS.id)).toBe(2);
    expect(await queries.countLiveProjects(RUST.id)).toBe(1);
    expect(await queries.countLiveProjects('tec_ghost')).toBe(0);
  });

  it('detaches the technology from archived projects only, inside the caller unit of work', async () => {
    const { w, queries } = setup();
    await w.uow.run(() => queries.detachFromArchivedProjects(NEXT_JS.id));
    expect(w.projects.get('old')?.technologyIds).toEqual([]);
    expect(w.projects.get('live1')?.technologyIds).toEqual([NEXT_JS.id]);
  });

  it('refuses to detach outside a unit of work', async () => {
    const { queries } = setup();
    await expect(queries.detachFromArchivedProjects(NEXT_JS.id)).rejects.toThrow(
      /unit of work|valid inside/,
    );
  });
});
