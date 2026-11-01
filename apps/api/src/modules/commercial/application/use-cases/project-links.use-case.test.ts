import { describe, expect, it } from 'vitest';
import {
  actor,
  projectRecord,
  projectWorld,
} from '../../../../../test/commercial/projects/fakes/world';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error';

const link = (id: string, group: 'REPOSITORIO' | 'ENTORNO', order: number) => ({
  id,
  group,
  label: id,
  url: `https://${id}.test`,
  order,
});

function world() {
  const w = projectWorld();
  w.projects.seed(
    projectRecord({
      links: [link('a', 'REPOSITORIO', 0), link('b', 'REPOSITORIO', 1), link('c', 'ENTORNO', 0)],
    }),
  );
  return w;
}

const ID = 'pry_kairos_web';

describe('project links (mock "project links", HU-07)', () => {
  it('upsert appends new links to their group, edits existing ones and validates the URL (CA1, CA3)', async () => {
    const w = world();
    const links = await w.upsertProjectLinks.execute(actor('MEMBER'), {
      id: ID,
      links: [
        { group: 'REPOSITORIO', label: 'Nuevo', url: 'https://nuevo.test', order: 0 },
        { id: 'c', group: 'ENTORNO', label: 'Prod', url: 'https://prod.test', order: 0 },
      ],
    });
    expect(links.filter((l) => l.group === 'REPOSITORIO').map((l) => [l.label, l.order])).toEqual([
      ['a', 0],
      ['b', 1],
      ['Nuevo', 2],
    ]);
    expect(links.find((l) => l.id === 'c')).toMatchObject({
      label: 'Prod',
      url: 'https://prod.test',
    });
    expect(w.activity.entries).toHaveLength(1);
    expect(w.activity.entries[0]).toMatchObject({
      action: 'UPDATE',
      changes: { links: 'changed' },
      metadata: { linkCount: 4 },
    });

    const before = w.projects.writeCount;
    await expect(
      w.upsertProjectLinks.execute(actor('OWNER'), {
        id: ID,
        links: [
          { group: 'OTRO', label: 'x', url: 'https://ok.test', order: 0 },
          { group: 'OTRO', label: 'y', url: 'javascript:alert(1)', order: 0 },
        ],
      }),
    ).rejects.toMatchObject({ fieldErrors: { 'links.1.url': ['validation.invalidFormat'] } });
    expect(w.projects.writeCount).toBe(before);
  });

  it('moves a link to another group at the end of that group', async () => {
    const w = world();
    const links = await w.upsertProjectLinks.execute(actor('OWNER'), {
      id: ID,
      links: [{ id: 'a', group: 'ENTORNO', label: 'a', url: 'https://a.test', order: 0 }],
    });
    expect(links.filter((l) => l.group === 'ENTORNO').map((l) => l.id)).toEqual(['c', 'a']);
    expect(links.filter((l) => l.group === 'REPOSITORIO').map((l) => [l.id, l.order])).toEqual([
      ['b', 0],
    ]);
  });

  it('answers a bare NOT_FOUND for an unknown link id that does not echo it (F10)', async () => {
    const w = world();
    const run = w.upsertProjectLinks.execute(actor('OWNER'), {
      id: ID,
      links: [{ id: 'lnk_secret', group: 'OTRO', label: 'x', url: 'https://x.test', order: 0 }],
    });
    await expect(run).rejects.toBeInstanceOf(NotFoundError);
    await expect(run).rejects.toMatchObject({ message: 'common.errors.NOT_FOUND' });
    await expect(
      w.removeProjectLink.execute(actor('OWNER'), { id: ID, linkId: 'lnk_secret' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reorders within one group, persists it and leaves the other groups alone (CA2)', async () => {
    const w = world();
    const links = await w.reorderProjectLinks.execute(actor('MEMBER'), {
      id: ID,
      group: 'REPOSITORIO',
      orderedLinkIds: ['b', 'a'],
    });
    expect(links.map((l) => [l.id, l.order])).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', 0],
    ]);
    expect(w.projects.get(ID)?.links.find((l) => l.id === 'b')?.order).toBe(0);
    expect(w.activity.entries[0]).toMatchObject({
      changes: { links: 'changed' },
      metadata: { group: 'REPOSITORIO' },
    });
  });

  it('refuses a reorder that does not list exactly the ids of the group', async () => {
    const w = world();
    for (const orderedLinkIds of [['a'], ['a', 'b', 'c'], ['a', 'x']]) {
      await expect(
        w.reorderProjectLinks.execute(actor('OWNER'), {
          id: ID,
          group: 'REPOSITORIO',
          orderedLinkIds,
        }),
      ).rejects.toMatchObject({ fieldErrors: { orderedLinkIds: ['validation.invalidOption'] } });
    }
    expect(w.activity.entries).toHaveLength(0);
  });

  it('removes a link and closes the gap in its group', async () => {
    const w = world();
    const links = await w.removeProjectLink.execute(actor('MEMBER'), { id: ID, linkId: 'a' });
    expect(links.map((l) => [l.id, l.order])).toEqual([
      ['b', 0],
      ['c', 0],
    ]);
    expect(w.activity.entries[0]).toMatchObject({
      metadata: { removedLabel: 'a', group: 'REPOSITORIO' },
    });
  });

  it('refuses a Viewer and an archived project', async () => {
    const w = world();
    await expect(
      w.removeProjectLink.execute(actor('VIEWER'), { id: ID, linkId: 'a' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    w.projects.seed(projectRecord({ id: 'pry_old', archivedAt: new Date('2026-03-01Z') }));
    await expect(
      w.removeProjectLink.execute(actor('OWNER'), { id: 'pry_old', linkId: 'a' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
