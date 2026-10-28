import { describe, expect, it } from 'vitest';
import { createWorld, seedUser, type World } from '../../../../../test/identity/world';
import { RecordLogin } from './record-login.use-case';

const build = (world: World) =>
  new RecordLogin(world.users, world.logins, world.uow, world.activity);

describe('RecordLogin (HU-01 CA4, Q-BE1-1)', () => {
  it('writes one LOGIN entry carrying the svix id', async () => {
    const world = createWorld();
    const { row } = seedUser(world, 'ADMIN', { clerkId: 'clerk_a' });

    const outcome = await build(world).execute({
      svixId: 'msg_1',
      data: { id: 'sess_1', user_id: 'clerk_a' },
    });

    expect(outcome).toBe('recorded');
    expect(world.activity.entries).toEqual([
      {
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'LOGIN',
        entityType: 'USER',
        entityId: row.id,
        entityLabel: row.name,
        metadata: { svixId: 'msg_1', sessionId: 'sess_1' },
      },
    ]);
  });

  it('the same svix id twice still writes one entry; a new id writes another', async () => {
    const world = createWorld();
    seedUser(world, 'ADMIN', { clerkId: 'clerk_a' });
    const login = build(world);
    const data = { user_id: 'clerk_a' };
    await login.execute({ svixId: 'msg_1', data });
    expect(await login.execute({ svixId: 'msg_1', data })).toBe('duplicate');
    expect(world.activity.entries).toHaveLength(1);
    await login.execute({ svixId: 'msg_2', data });
    expect(world.activity.entries).toHaveLength(2);
  });

  it('a user the webhook has not created yet is NOT_FOUND (so Svix redelivers); nothing is written', async () => {
    const world = createWorld();
    await expect(
      build(world).execute({ svixId: 'msg_1', data: { user_id: 'clerk_unknown' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(world.activity.entries).toHaveLength(0);
  });

  it('ignores a payload without user_id', async () => {
    const world = createWorld();
    expect(await build(world).execute({ svixId: 'msg_1', data: {} })).toBe('ignored');
  });
});
