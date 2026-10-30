import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  NEXT_JS,
  projectRecord,
  projectWorld,
} from '../../../../../test/commercial/projects/fakes/world';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error';

function world() {
  const w = projectWorld();
  w.projects.seed(
    projectRecord({
      archivedAt: new Date('2026-03-01Z'),
      technologyIds: [NEXT_JS.id],
    }),
  );
  w.metrics.addClient(KAIROS);
  return w;
}

describe('RestoreProject (HU-28 CA2)', () => {
  it('clears the archive, logs RESTORE, reindexes and recounts the clients', async () => {
    const w = world();
    const restored = await w.restoreProject.execute(actor('ADMIN'), 'pry_kairos_web');
    expect(restored).toEqual({
      entity: { type: 'PROJECT', id: 'pry_kairos_web', code: 'PRY-0001', label: 'Sitio Kairós' },
      restoredAt: w.clock.now(),
    });
    expect(w.projects.get('pry_kairos_web')?.archivedAt).toBeNull();
    expect(w.activity.entries).toHaveLength(1);
    expect(w.activity.entries[0]).toMatchObject({
      action: 'RESTORE',
      entityId: 'pry_kairos_web',
      clientId: KAIROS,
    });
    expect(w.searchIndex.get('PROJECT', 'pry_kairos_web')).toMatchObject({
      archived: false,
      title: 'Sitio Kairós',
    });
    expect(w.metrics.get(KAIROS)?.projectCount).toBe(1);
  });

  it('is NOT_FOUND for a live or unknown project', async () => {
    const w = world();
    w.projects.seed(projectRecord({ id: 'pry_live' }));
    for (const id of ['pry_live', 'pry_ghost']) {
      await expect(w.restoreProject.execute(actor('OWNER'), id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    expect(w.activity.entries).toHaveLength(0);
  });

  it('does not bring back a technology deleted meanwhile (carried item)', async () => {
    const w = world();
    // The technology delete detached the stack link of the archived project (HU-06 CA3).
    await w.uow.run(() => w.projects.detachTechnologyFromArchived(NEXT_JS.id));
    await w.restoreProject.execute(actor('OWNER'), 'pry_kairos_web');
    expect(w.projects.get('pry_kairos_web')?.technologyIds).toEqual([]);
  });

  it('is for the trash roles only: Member and Viewer are FORBIDDEN', async () => {
    const w = world();
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      await expect(w.restoreProject.execute(actor(role), 'pry_kairos_web')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});
