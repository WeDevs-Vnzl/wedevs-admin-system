import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  projectRecord,
  projectWorld,
  REACT,
} from '../../../../../test/commercial/projects/fakes/world';

const ID = 'pry_kairos_web';

function world(over: Parameters<typeof projectRecord>[0] = {}) {
  const w = projectWorld();
  w.projects.seed(projectRecord(over));
  w.metrics.addClient(KAIROS);
  return w;
}

const owner = actor('OWNER');
const fields = {
  id: ID,
  name: 'Sitio Kairós',
  summary: 'Sitio corporativo',
  clients: [{ clientId: KAIROS }],
  technologyIds: [],
  tagIds: [],
};

/** B3: a mutation decides on the state it later writes over, so each one loads the project locked. */
describe('every project mutation loads the project with its row lock', () => {
  const cases: [string, (w: ReturnType<typeof world>) => Promise<unknown>, object?][] = [
    ['UpdateProject', (w) => w.updateProject.execute(owner, fields)],
    [
      'SetProjectStatus',
      (w) =>
        w.setProjectStatus.execute(owner, {
          id: ID,
          status: 'CANCELADO',
          cancelPendingInstallments: false,
          finishRecurringCharges: false,
          confirm: true,
        }),
    ],
    [
      'SetProjectClients',
      (w) => w.setProjectClients.execute(owner, { id: ID, clients: [{ clientId: KAIROS }] }),
    ],
    [
      'SetProjectTechnologies',
      (w) => w.setProjectTechnologies.execute(owner, { id: ID, technologyIds: [REACT.id] }),
    ],
    [
      'UpsertProjectLinks',
      (w) =>
        w.upsertProjectLinks.execute(owner, {
          id: ID,
          links: [{ group: 'REPOSITORIO', label: 'Repo', url: 'https://r.test', order: 0 }],
        }),
    ],
    [
      'ReorderProjectLinks',
      (w) =>
        w.reorderProjectLinks.execute(owner, { id: ID, group: 'REPOSITORIO', orderedLinkIds: [] }),
    ],
    ['ArchiveProjects', (w) => w.archiveProjects.execute(owner, { ids: [ID], confirm: true })],
    [
      'RestoreProject',
      (w) => w.restoreProject.execute(owner, ID),
      { archivedAt: new Date('2026-02-01T00:00:00Z') },
    ],
  ];

  it.each(cases)('%s', async (_name, run, seed) => {
    const w = world(seed);
    await run(w).catch(() => undefined);
    expect(w.projects.lockedProjects).toContain(ID);
  });

  it('RemoveProjectLink', async () => {
    const w = world({
      links: [{ id: 'a', group: 'REPOSITORIO', label: 'a', url: 'https://a.test', order: 0 }],
    });
    await w.removeProjectLink.execute(owner, { id: ID, linkId: 'a' });
    expect(w.projects.lockedProjects).toContain(ID);
  });

  it('a bulk archive locks the projects in ascending id order', async () => {
    const w = projectWorld();
    w.projects.seed(projectRecord({ id: 'p_b', code: 'PRY-0002' }), projectRecord({ id: 'p_a' }));
    await w.archiveProjects.execute(owner, { ids: ['p_b', 'p_a'], confirm: true });
    expect(w.projects.lockedProjects).toEqual(['p_a', 'p_b']);
  });
});
