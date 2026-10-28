import { describe, expect, it } from 'vitest';
import { createWorld, userOf } from '../../../../../test/settings/tags/world';

function seeded() {
  const w = createWorld();
  w.seedTag('t_a', 'Alpha', '#0000AA', '2026-01-01T00:00:00.000Z');
  w.seedTag('t_b', 'Beta', '#0000BB', '2026-01-02T00:00:00.000Z');
  w.clients.add('cli_1', 'Acme', 'cli_1');
  w.projects.add('pry_1', 'Web', 'cli_1');
  w.notes.add('note_1', 'Idea', null);
  return w;
}

describe('AssignTags', () => {
  it('adds tags, ignores the ones already assigned and returns the chips in order', async () => {
    const w = seeded();
    await w.assignTags.execute(userOf('OWNER'), {
      entityType: 'CLIENT',
      entityId: 'cli_1',
      tagIds: ['t_a'],
    });
    const chips = await w.assignTags.execute(userOf('OWNER'), {
      entityType: 'CLIENT',
      entityId: 'cli_1',
      tagIds: ['t_a', 't_b'],
    });
    expect(chips).toEqual([
      { id: 't_a', name: 'Alpha', color: '#0000AA' },
      { id: 't_b', name: 'Beta', color: '#0000BB' },
    ]);
  });

  it('logs one LINK per tag actually added, with the target clientId and the tag in metadata', async () => {
    const w = seeded();
    await w.assignTags.execute(userOf('ADMIN'), {
      entityType: 'PROJECT',
      entityId: 'pry_1',
      tagIds: ['t_a', 't_b'],
    });
    expect(w.activity.entries).toMatchObject([
      {
        action: 'LINK',
        entityType: 'PROJECT',
        entityId: 'pry_1',
        entityLabel: 'Web',
        clientId: 'cli_1',
        metadata: { tagId: 't_a', tagName: 'Alpha' },
      },
      { action: 'LINK', metadata: { tagId: 't_b', tagName: 'Beta' } },
    ]);
    await w.assignTags.execute(userOf('ADMIN'), {
      entityType: 'PROJECT',
      entityId: 'pry_1',
      tagIds: ['t_a'],
    });
    expect(w.activity.entries).toHaveLength(2);
  });

  it('lets a Member tag projects and notes but not clients; a Viewer nothing', async () => {
    const w = seeded();
    const base = { tagIds: ['t_a'] };
    await expect(
      w.assignTags.execute(userOf('MEMBER'), { ...base, entityType: 'PROJECT', entityId: 'pry_1' }),
    ).resolves.toHaveLength(1);
    await expect(
      w.assignTags.execute(userOf('MEMBER'), { ...base, entityType: 'NOTE', entityId: 'note_1' }),
    ).resolves.toHaveLength(1);
    await expect(
      w.assignTags.execute(userOf('MEMBER'), { ...base, entityType: 'CLIENT', entityId: 'cli_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      w.assignTags.execute(userOf('VIEWER'), { ...base, entityType: 'PROJECT', entityId: 'pry_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(w.assignmentRepo.committedIds({ entityType: 'CLIENT', entityId: 'cli_1' })).toEqual([]);
  });

  it('answers NOT_FOUND for an unknown or archived record', async () => {
    const w = seeded();
    const tagIds = ['t_a'];
    await expect(
      w.assignTags.execute(userOf('OWNER'), { entityType: 'NOTE', entityId: 'note_x', tagIds }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    w.clients.archive('cli_1');
    await expect(
      w.assignTags.execute(userOf('OWNER'), { entityType: 'CLIENT', entityId: 'cli_1', tagIds }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers VALIDATION on entityType for types nobody registered (INVOICE until BE-3)', async () => {
    const w = seeded();
    await expect(
      w.assignTags.execute(userOf('OWNER'), {
        entityType: 'INVOICE',
        entityId: 'inv_1',
        tagIds: ['t_a'],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { entityType: ['validation.invalidOption'] },
    });
  });

  it('answers VALIDATION on tagIds for an unknown tag and records nothing', async () => {
    const w = seeded();
    await expect(
      w.assignTags.execute(userOf('OWNER'), {
        entityType: 'CLIENT',
        entityId: 'cli_1',
        tagIds: ['t_a', 'tag_missing'],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { tagIds: ['validation.invalidOption'] },
    });
    expect(w.assignmentRepo.committedIds({ entityType: 'CLIENT', entityId: 'cli_1' })).toEqual([]);
    expect(w.activity.entries).toHaveLength(0);
  });
});

describe('UnassignTag', () => {
  it('removes one tag, returns the remaining chips and logs one UNLINK', async () => {
    const w = seeded();
    await w.assignTags.execute(userOf('ADMIN'), {
      entityType: 'PROJECT',
      entityId: 'pry_1',
      tagIds: ['t_a', 't_b'],
    });
    const chips = await w.unassignTag.execute(userOf('ADMIN'), {
      entityType: 'PROJECT',
      entityId: 'pry_1',
      tagId: 't_a',
    });
    expect(chips.map((c) => c.id)).toEqual(['t_b']);
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'UNLINK',
      entityType: 'PROJECT',
      clientId: 'cli_1',
      metadata: { tagId: 't_a', tagName: 'Alpha' },
    });
  });

  it('writes no entry when the tag was not assigned', async () => {
    const w = seeded();
    const chips = await w.unassignTag.execute(userOf('OWNER'), {
      entityType: 'CLIENT',
      entityId: 'cli_1',
      tagId: 't_a',
    });
    expect(chips).toEqual([]);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('applies the per-target grant and NOT_FOUND like assign', async () => {
    const w = seeded();
    const base = { tagId: 't_a' };
    await expect(
      w.unassignTag.execute(userOf('MEMBER'), { ...base, entityType: 'CLIENT', entityId: 'cli_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      w.unassignTag.execute(userOf('OWNER'), { ...base, entityType: 'CLIENT', entityId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      w.unassignTag.execute(userOf('OWNER'), { ...base, entityType: 'PAYMENT', entityId: 'p' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
