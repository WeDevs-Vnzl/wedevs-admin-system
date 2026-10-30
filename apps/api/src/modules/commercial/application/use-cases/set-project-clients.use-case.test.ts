import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  projectRecord,
  projectWorld,
  TORNILLO,
} from '../../../../../test/commercial/projects/fakes/world';
import { NotFoundError, ValidationFailedError } from '../../../../shared/domain/domain-error';

function world() {
  const w = projectWorld();
  w.projects.seed(projectRecord());
  return w;
}

describe('SetProjectClients (mock setProjectClients)', () => {
  it('replaces the clients with roles and logs LINK, UNLINK and role changes', async () => {
    const w = world();
    const detail = await w.setProjectClients.execute(actor('MEMBER'), {
      id: 'pry_kairos_web',
      clients: [
        { clientId: KAIROS, role: 'Usuario final' },
        { clientId: TORNILLO, role: 'Contratante' },
      ],
    });
    expect(detail.clients.map((c) => [c.client.id, c.role])).toEqual([
      [KAIROS, 'Usuario final'],
      [TORNILLO, 'Contratante'],
    ]);
    expect(w.activity.entries.map((e) => e.action)).toEqual(['UPDATE', 'LINK']);
    expect(w.activity.entries[0]).toMatchObject({
      changes: { clientRole: ['Contratante', 'Usuario final'] },
    });

    await w.setProjectClients.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      clients: [{ clientId: TORNILLO, role: 'Contratante' }],
    });
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'UNLINK',
      metadata: { linkedId: KAIROS, linkedLabel: 'Kairós' },
    });
  });

  it('keeps projectCount in step for old and new clients (HU-05, Q-BE2-2)', async () => {
    const w = world();
    w.metrics.addClient(TORNILLO);
    await w.setProjectClients.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      clients: [{ clientId: KAIROS }, { clientId: TORNILLO }],
    });
    expect(w.metrics.get(KAIROS)?.projectCount).toBe(1);
    expect(w.metrics.get(TORNILLO)?.projectCount).toBe(1);

    await w.setProjectClients.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      clients: [{ clientId: TORNILLO }],
    });
    expect(w.metrics.get(KAIROS)?.projectCount).toBe(0);
    expect(w.metrics.get(TORNILLO)?.projectCount).toBe(1);
  });

  it('refuses an empty list, a repeated client and an unknown client', async () => {
    const w = world();
    const run = (clients: { clientId: string }[]) =>
      w.setProjectClients.execute(actor('OWNER'), { id: 'pry_kairos_web', clients });
    await expect(run([])).rejects.toMatchObject({
      fieldErrors: { clients: ['validation.required'] },
    });
    await expect(run([{ clientId: KAIROS }, { clientId: KAIROS }])).rejects.toMatchObject({
      fieldErrors: { clients: ['validation.invalidOption'] },
    });
    await expect(run([{ clientId: 'cli_ghost' }])).rejects.toBeInstanceOf(ValidationFailedError);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('writes nothing for an unchanged set and answers NOT_FOUND for archived or unknown projects', async () => {
    const w = world();
    await w.setProjectClients.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      clients: [{ clientId: KAIROS, role: 'Contratante' }],
    });
    expect(w.activity.entries).toHaveLength(0);
    expect(w.projects.writeCount).toBe(0);

    w.projects.seed(projectRecord({ id: 'pry_old', archivedAt: new Date('2026-03-01Z') }));
    for (const id of ['pry_old', 'pry_ghost']) {
      await expect(
        w.setProjectClients.execute(actor('OWNER'), { id, clients: [{ clientId: KAIROS }] }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});
