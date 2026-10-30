import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  projectRecord,
  projectWorld,
  TORNILLO,
} from '../../../../../test/commercial/projects/fakes/world';
import {
  ForbiddenError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';

function world() {
  const w = projectWorld();
  w.projects.seed(
    projectRecord({ id: 'p1', code: 'PRY-0001', name: 'Uno' }),
    projectRecord({
      id: 'p2',
      code: 'PRY-0002',
      name: 'Dos',
      clients: [
        { clientId: KAIROS, role: null, linkedAt: new Date('2026-01-01Z') },
        { clientId: TORNILLO, role: null, linkedAt: new Date('2026-01-02Z') },
      ],
    }),
  );
  return w;
}

describe('ArchiveProjects (mock archiveProject / archiveProjects)', () => {
  it('archives, records who and logs DELETE; archiving twice is NOT_FOUND', async () => {
    const w = world();
    const [archived] = await w.archiveProjects.execute(actor('ADMIN'), {
      ids: ['p1'],
      confirm: false,
    });
    expect(archived).toEqual({ id: 'p1', archivedAt: w.clock.now() });
    expect(w.projects.get('p1')?.archivedAt).toEqual(w.clock.now());
    expect(w.activity.entries).toHaveLength(1);
    expect(w.activity.entries[0]).toMatchObject({
      action: 'DELETE',
      entityId: 'p1',
      clientId: KAIROS,
      metadata: { code: 'PRY-0001' },
    });
    expect(w.searchIndex.get('PROJECT', 'p1')).toBeUndefined();

    await expect(
      w.archiveProjects.execute(actor('ADMIN'), { ids: ['p1'], confirm: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('archives the search entry and recounts every linked client (Q-BE2-2)', async () => {
    const w = world();
    w.metrics.addClient(KAIROS);
    w.metrics.addClient(TORNILLO);
    await w.createProject.execute(actor('OWNER'), {
      name: 'Tres',
      summary: 's',
      status: 'PROPUESTA',
      clients: [{ clientId: KAIROS }, { clientId: TORNILLO }],
      technologyIds: [],
      tagIds: [],
      links: [],
    });
    const created = w.projects.rows.find((p) => p.name === 'Tres');
    expect(w.metrics.get(KAIROS)?.projectCount).toBe(3);
    expect(w.metrics.get(TORNILLO)?.projectCount).toBe(2);

    await w.archiveProjects.execute(actor('OWNER'), { ids: [created?.id ?? ''], confirm: false });
    expect(w.searchIndex.get('PROJECT', created?.id ?? '')?.archived).toBe(true);
    expect(w.metrics.get(KAIROS)?.projectCount).toBe(2);
    expect(w.metrics.get(TORNILLO)?.projectCount).toBe(1);
  });

  it('asks for confirm when billing is active (INTEGRITY_LOCK) and archives with it', async () => {
    const w = world();
    w.billing.activeBilling.add('p1');
    const run = w.archiveProjects.execute(actor('OWNER'), { ids: ['p1'], confirm: false });
    await expect(run).rejects.toBeInstanceOf(IntegrityLockedError);
    await expect(run).rejects.toMatchObject({
      message: 'projects.errors.archiveNeedsConfirm',
      entity: { type: 'PROJECT', id: 'p1', code: 'PRY-0001' },
    });
    expect(w.projects.get('p1')?.archivedAt).toBeNull();

    await w.archiveProjects.execute(actor('OWNER'), { ids: ['p1'], confirm: true });
    expect(w.projects.get('p1')?.archivedAt).not.toBeNull();
  });

  it('archives many or none', async () => {
    const w = world();
    w.billing.activeBilling.add('p2');
    await expect(
      w.archiveProjects.execute(actor('OWNER'), { ids: ['p1', 'p2'], confirm: false }),
    ).rejects.toBeInstanceOf(IntegrityLockedError);
    await expect(
      w.archiveProjects.execute(actor('OWNER'), { ids: ['p1', 'p_ghost'], confirm: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(w.projects.rows.every((p) => p.archivedAt === null)).toBe(true);
    expect(w.activity.entries).toHaveLength(0);

    const archived = await w.archiveProjects.execute(actor('OWNER'), {
      ids: ['p1', 'p2', 'p1'],
      confirm: true,
    });
    expect(archived.map((a) => a.id)).toEqual(['p1', 'p2']);
    expect(w.activity.entries).toHaveLength(2);
  });

  it('is for Owner and Admin only: Member and Viewer are FORBIDDEN (PRD §4.3)', async () => {
    const w = world();
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      await expect(
        w.archiveProjects.execute(actor(role), { ids: ['p1'], confirm: true }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
