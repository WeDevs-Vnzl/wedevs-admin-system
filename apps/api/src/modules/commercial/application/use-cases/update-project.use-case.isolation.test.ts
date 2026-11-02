import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  projectRecord,
  projectWorld,
  TORNILLO,
} from '../../../../../test/commercial/projects/fakes/world';

/**
 * Every project flow that writes the project's `SearchEntry` opens a `Serializable` unit of work (DT-177): the
 * entry carries the clients' names, which a rename rewrites in its own `Serializable` unit of work, and only
 * that level retries the loser of a serialization failure.
 */
const SERIALIZABLE = { isolation: 'Serializable' };

function world() {
  const w = projectWorld();
  w.metrics.addClient(KAIROS);
  return w;
}

describe('project flows run Serializable (DT-177)', () => {
  it('CreateProject', async () => {
    const w = world();
    await w.createProject.execute(actor('OWNER'), {
      name: 'Sitio',
      summary: 'Resumen',
      status: 'PROPUESTA',
      clients: [{ clientId: KAIROS, role: 'Contratante' }],
      technologyIds: [],
      tagIds: [],
      links: [],
    });
    expect(w.uow.lastOptions).toEqual(SERIALIZABLE);
  });

  it('UpdateProject', async () => {
    const w = world();
    w.projects.seed(projectRecord());
    await w.updateProject.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      name: 'Sitio Kairós',
      summary: 'Sitio corporativo',
      clients: [{ clientId: KAIROS, role: 'Contratante' }],
      technologyIds: [],
      tagIds: [],
    });
    expect(w.uow.lastOptions).toEqual(SERIALIZABLE);
  });

  it('SetProjectClients', async () => {
    const w = world();
    w.projects.seed(projectRecord());
    await w.setProjectClients.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      clients: [
        { clientId: KAIROS, role: 'Contratante' },
        { clientId: TORNILLO, role: 'Contratante' },
      ],
    });
    expect(w.uow.lastOptions).toEqual(SERIALIZABLE);
  });

  it('RestoreProject', async () => {
    const w = world();
    w.projects.seed(projectRecord({ archivedAt: new Date('2026-03-01Z') }));
    await w.restoreProject.execute(actor('ADMIN'), 'pry_kairos_web');
    expect(w.uow.lastOptions).toEqual(SERIALIZABLE);
  });
});
