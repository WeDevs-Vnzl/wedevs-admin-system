import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  projectRecord,
  projectWorld,
  REACT,
  TORNILLO,
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

/** M1, M2: the client rows are locked up front, as one ascending batch (projects → clients). */
describe('project paths lock their clients before they write or recount', () => {
  const both = [KAIROS, TORNILLO].sort();

  it('CreateProject locks the new clients, ascending', async () => {
    const w = projectWorld();
    await w.createProject.execute(owner, {
      name: 'Nuevo',
      summary: 'Resumen',
      status: 'PROPUESTA',
      clients: [{ clientId: TORNILLO }, { clientId: KAIROS }],
      technologyIds: [],
      tagIds: [],
      links: [],
    });
    expect(w.projects.lockedClients[0]).toEqual(both);
  });

  it('UpdateProject and SetProjectClients lock the old and the new clients in one batch', async () => {
    const u = world();
    await u.updateProject.execute(owner, { ...fields, clients: [{ clientId: TORNILLO }] });
    expect(u.projects.lockedClients[0]).toEqual(both);

    const s = world();
    await s.setProjectClients.execute(owner, { id: ID, clients: [{ clientId: TORNILLO }] });
    expect(s.projects.lockedClients[0]).toEqual(both);
  });

  it('ArchiveProjects and RestoreProject lock the clients of the projects', async () => {
    const a = world();
    await a.archiveProjects.execute(owner, { ids: [ID], confirm: true });
    expect(a.projects.lockedClients[0]).toEqual([KAIROS]);

    const r = world({ archivedAt: new Date('2026-02-01T00:00:00Z') });
    await r.restoreProject.execute(owner, ID);
    expect(r.projects.lockedClients[0]).toEqual([KAIROS]);
  });

  it('the recount locks the clients it counts, ascending', async () => {
    const w = world();
    await w.updateProject.execute(owner, { ...fields, clients: [{ clientId: TORNILLO }] });
    expect(w.projects.lockedClients.at(-1)).toEqual(both);
  });
});
