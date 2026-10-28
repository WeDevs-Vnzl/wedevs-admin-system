import { describe, expect, it } from 'vitest';
import { FakeAuthorization } from '../../../../../test/support/fakes/fake-authorization';
import {
  FakeRestoreHandler,
  admin,
  buildTrashHarness,
  member,
  owner,
} from '../../../../../test/trash/harness';
import { RestoreFromTrash } from './restore-from-trash.use-case';

function setup() {
  const h = buildTrashHarness();
  const project = new FakeRestoreHandler('PROJECT', 'project');
  project.archived.add('pry_1');
  h.registry.register(project);
  return { ...h, project };
}

describe('RestoreFromTrash', () => {
  it('delegates to the registered handler and returns the entity with the restore instant', async () => {
    const h = setup();
    const out = await h.restoreFromTrash.execute(admin, {
      entityType: 'PROJECT',
      entityId: 'pry_1',
    });
    expect(out).toEqual({
      entity: { type: 'PROJECT', id: 'pry_1', label: 'Label pry_1' },
      restoredAt: new Date('2026-10-25T15:00:00.000Z'),
    });
    expect(h.project.calls).toEqual([{ user: admin, entityId: 'pry_1' }]);
  });

  it('an unregistered or non-archivable type is NOT_FOUND and nothing is called', async () => {
    const h = setup();
    for (const entityType of ['CLIENT', 'PAYMENT'] as const) {
      await expect(
        h.restoreFromTrash.execute(owner, { entityType, entityId: 'x' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(h.project.calls).toHaveLength(0);
  });

  it('refuses an actor without restore on the resource (FORBIDDEN) before calling the handler', async () => {
    const h = setup();
    await expect(
      h.restoreFromTrash.execute(member, { entityType: 'PROJECT', entityId: 'pry_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.project.calls).toHaveLength(0);
    expect(h.project.archived.has('pry_1')).toBe(true);
    const policy = new FakeAuthorization({ policy: (_u, action) => action !== 'restore' });
    const useCase = new RestoreFromTrash(policy, h.registry, h.clock);
    await expect(
      useCase.execute(owner, { entityType: 'PROJECT', entityId: 'pry_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a live record or unknown id (handler NOT_FOUND) propagates', async () => {
    const h = setup();
    await expect(
      h.restoreFromTrash.execute(owner, { entityType: 'PROJECT', entityId: 'live' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a handler CONFLICT propagates with its entity', async () => {
    const h = setup();
    h.project.conflictWith = { type: 'CLIENT', id: 'cli_holder', label: 'Holder' };
    await expect(
      h.restoreFromTrash.execute(owner, { entityType: 'PROJECT', entityId: 'pry_1' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      entity: { type: 'CLIENT', id: 'cli_holder' },
    });
    expect(h.project.archived.has('pry_1')).toBe(true);
  });
});
