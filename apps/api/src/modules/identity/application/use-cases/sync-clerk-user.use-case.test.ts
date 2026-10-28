import { describe, expect, it } from 'vitest';
import { createWorld, seedUser, type World } from '../../../../../test/identity/world';
import { SyncClerkUser, type ClerkUserEvent } from './sync-clerk-user.use-case';

const build = (world: World) =>
  new SyncClerkUser(world.users, world.uow, world.activity, world.clock, world.ids);

function userPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user_clerk_1',
    first_name: 'Valeria',
    last_name: 'Rojas',
    image_url: 'https://img.example.com/v.png',
    primary_email_address_id: 'idn_2',
    email_addresses: [
      { id: 'idn_1', email_address: 'old@example.com' },
      { id: 'idn_2', email_address: 'Valeria.Rojas@Example.com' },
    ],
    public_metadata: { role: 'OWNER' },
    ...over,
  };
}
const event = (type: ClerkUserEvent['type'], data = userPayload()): ClerkUserEvent => ({
  type,
  data,
});

describe('user.created (Q-BE1-2)', () => {
  it('creates the User with the invited role, the primary lower-cased e-mail and a SYSTEM CREATE entry', async () => {
    const world = createWorld();
    expect(await build(world).execute(event('user.created'))).toBe('created');

    expect(world.users.all()).toHaveLength(1);
    expect(world.users.all()[0]).toMatchObject({
      id: 'usr_1',
      clerkId: 'user_clerk_1',
      email: 'valeria.rojas@example.com',
      name: 'Valeria Rojas',
      imageUrl: 'https://img.example.com/v.png',
      role: 'OWNER',
    });
    expect(world.activity.entries).toMatchObject([
      {
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'CREATE',
        entityType: 'USER',
        entityId: 'usr_1',
        metadata: { source: 'clerk', role: 'OWNER' },
      },
    ]);
  });

  it('a missing or invalid role becomes VIEWER, never the schema default', async () => {
    for (const public_metadata of [undefined, {}, { role: 'ROOT' }, { role: 'owner' }]) {
      const world = createWorld();
      await build(world).execute(event('user.created', userPayload({ public_metadata })));
      expect(world.users.all()[0]?.role).toBe('VIEWER');
    }
  });

  it('derives the name from the e-mail when Clerk has none', async () => {
    const world = createWorld();
    await build(world).execute(
      event('user.created', userPayload({ first_name: null, last_name: '' })),
    );
    expect(world.users.all()[0]?.name).toBe('valeria.rojas');
  });

  it('is idempotent: a redelivery changes and logs nothing', async () => {
    const world = createWorld();
    const sync = build(world);
    await sync.execute(event('user.created'));
    expect(
      await sync.execute(
        event('user.created', userPayload({ public_metadata: { role: 'VIEWER' } })),
      ),
    ).toBe('unchanged');
    expect(world.users.all()).toHaveLength(1);
    expect(world.users.all()[0]?.role).toBe('OWNER');
    expect(world.activity.entries).toHaveLength(1);
  });

  it('does not resurrect a deleted user when created is redelivered after deleted', async () => {
    const world = createWorld();
    const sync = build(world);
    await sync.execute(event('user.created'));
    await sync.execute(event('user.deleted', { id: 'user_clerk_1', deleted: true }));
    expect(await sync.execute(event('user.created'))).toBe('unchanged');
    expect(await world.users.findActiveByClerkId('user_clerk_1')).toBeNull();
  });

  it('a concurrent duplicate create (lost insert race) is unchanged, not a crash', async () => {
    const world = createWorld();
    const sync = build(world);
    await sync.execute(event('user.created'));
    // The pre-check misses the row (the other delivery commits after it), the insert then conflicts.
    world.users.findAnyByClerkId = () => Promise.resolve(null);
    world.users.findAnyByEmail = () => Promise.resolve(null);
    expect(await sync.execute(event('user.created'))).toBe('unchanged');
    expect(world.users.all()).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(1);
  });

  it('an e-mail held by another account is a CONFLICT, nothing written', async () => {
    const world = createWorld();
    seedUser(world, 'ADMIN', { email: 'valeria.rojas@example.com' });
    await expect(build(world).execute(event('user.created'))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(world.users.all()).toHaveLength(1);
  });

  it('ignores a payload without id or usable e-mail', async () => {
    const world = createWorld();
    const sync = build(world);
    expect(await sync.execute(event('user.created', userPayload({ id: undefined })))).toBe(
      'ignored',
    );
    expect(await sync.execute(event('user.created', userPayload({ email_addresses: [] })))).toBe(
      'ignored',
    );
    expect(world.users.all()).toHaveLength(0);
  });
});

describe('user.updated', () => {
  it('rewrites e-mail, name and image but never the role (C13)', async () => {
    const world = createWorld();
    const sync = build(world);
    await sync.execute(event('user.created'));
    world.clock.set('2026-03-01T00:00:00.000Z');

    const outcome = await sync.execute(
      event(
        'user.updated',
        userPayload({
          first_name: 'Vale',
          image_url: null,
          public_metadata: { role: 'VIEWER' },
        }),
      ),
    );

    expect(outcome).toBe('updated');
    expect(world.users.all()[0]).toMatchObject({
      name: 'Vale Rojas',
      imageUrl: null,
      role: 'OWNER',
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    expect(world.activity.entries.at(-1)).toMatchObject({
      actor: { actorType: 'SYSTEM', userId: null },
      action: 'UPDATE',
      changes: {
        name: ['Valeria Rojas', 'Vale Rojas'],
        imageUrl: ['https://img.example.com/v.png', null],
      },
    });
  });

  it('is unchanged when nothing differs, and ignored for an unknown or deleted user', async () => {
    const world = createWorld();
    const sync = build(world);
    expect(await sync.execute(event('user.updated'))).toBe('ignored');
    await sync.execute(event('user.created'));
    expect(await sync.execute(event('user.updated'))).toBe('unchanged');
    await sync.execute(event('user.deleted', { id: 'user_clerk_1', deleted: true }));
    expect(await sync.execute(event('user.updated', userPayload({ first_name: 'Z' })))).toBe(
      'ignored',
    );
  });
});

describe('user.deleted', () => {
  it('soft deletes the user (later authentication fails) and logs a SYSTEM DELETE', async () => {
    const world = createWorld();
    const sync = build(world);
    await sync.execute(event('user.created'));

    expect(await sync.execute(event('user.deleted', { id: 'user_clerk_1', deleted: true }))).toBe(
      'deleted',
    );

    expect(world.users.all()[0]?.deletedAt).not.toBeNull();
    expect(await world.users.findActiveByClerkId('user_clerk_1')).toBeNull();
    expect(world.activity.entries.at(-1)).toMatchObject({ action: 'DELETE', entityType: 'USER' });
  });

  it('is idempotent and tolerates an unknown id', async () => {
    const world = createWorld();
    const sync = build(world);
    expect(await sync.execute(event('user.deleted', { id: 'user_unknown', deleted: true }))).toBe(
      'unchanged',
    );
    await sync.execute(event('user.created'));
    await sync.execute(event('user.deleted', { id: 'user_clerk_1' }));
    expect(await sync.execute(event('user.deleted', { id: 'user_clerk_1' }))).toBe('unchanged');
    expect(world.activity.entries.filter((e) => e.action === 'DELETE')).toHaveLength(1);
  });
});
