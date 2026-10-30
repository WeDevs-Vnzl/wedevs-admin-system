import { describe, expect, it } from 'vitest';
import { createWorld, rejection } from '../../../../../test/commercial/clients/world';

describe('SetClientStatus', () => {
  it('logs STATUS_CHANGE and sets activatedAt only the first time it becomes ACTIVO', async () => {
    const w = createWorld();
    const { client } = w.seedClient({ id: 'cli_1', status: 'PROSPECTO' });
    const active = await w.setClientStatus.execute(w.owner, { id: client.id, status: 'ACTIVO' });
    expect(active.client.activatedAt).toEqual(w.clock.now());
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'STATUS_CHANGE',
      entityType: 'CLIENT',
      clientId: client.id,
      changes: { status: ['PROSPECTO', 'ACTIVO'] },
    });
    expect(w.search.get('CLIENT', client.id)).toMatchObject({ status: 'ACTIVO' });

    w.clock.advance(60_000);
    await w.setClientStatus.execute(w.owner, { id: client.id, status: 'INACTIVO' });
    w.clock.advance(60_000);
    const again = await w.setClientStatus.execute(w.owner, { id: client.id, status: 'ACTIVO' });
    expect(again.client.activatedAt).toEqual(active.client.activatedAt);
  });

  it('is a no-op without an activity entry when the status is the same', async () => {
    const w = createWorld();
    const { client } = w.seedClient({ status: 'ACTIVO' });
    await w.setClientStatus.execute(w.owner, { id: client.id, status: 'ACTIVO' });
    expect(w.activity.entries).toHaveLength(0);
  });

  it('answers NOT_FOUND for an unknown or archived client and VALIDATION for an unknown status', async () => {
    const w = createWorld();
    const archived = w.seedClient({ deletedAt: new Date() }).client;
    for (const id of ['cli_nope', archived.id]) {
      expect(
        (await rejection(w.setClientStatus.execute(w.owner, { id, status: 'ACTIVO' }))).code,
      ).toBe('NOT_FOUND');
    }
    const live = w.seedClient().client;
    const error = await rejection(
      w.setClientStatus.execute(w.owner, { id: live.id, status: 'NOPE' as 'ACTIVO' }),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { status: ['validation.invalidOption'] },
    });
  });

  it('is FORBIDDEN for Viewer', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    expect(
      (await rejection(w.setClientStatus.execute(w.viewer, { id: client.id, status: 'ACTIVO' })))
        .code,
    ).toBe('FORBIDDEN');
  });
});
