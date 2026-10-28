import { describe, expect, it } from 'vitest';
import { createWorld, seedUser } from '../../../../../test/identity/world';
import { AuthenticateRequest } from './authenticate-request.use-case';

describe('AuthenticateRequest', () => {
  it('resolves the active local user of a valid token; the DB role is the source (C13)', async () => {
    const world = createWorld();
    const { row } = seedUser(world, 'MEMBER', { clerkId: 'clerk_x' });
    const token = world.identity.issue('clerk_x');
    const auth = new AuthenticateRequest(world.identity, world.users);

    expect(await auth.authenticate(token)).toEqual({
      userId: row.id,
      clerkId: 'clerk_x',
      role: 'MEMBER',
      email: row.email,
      name: row.name,
    });
  });

  it('HU-01 CA1: a valid token of an unknown clerkId is not authenticated (no JIT provisioning)', async () => {
    const world = createWorld();
    const auth = new AuthenticateRequest(world.identity, world.users);
    expect(await auth.authenticate(world.identity.issue('clerk_nobody'))).toBeNull();
    expect(world.users.all()).toHaveLength(0);
  });

  it('refuses a deleted user and an invalid token', async () => {
    const world = createWorld();
    seedUser(world, 'ADMIN', { clerkId: 'clerk_gone', deletedAt: new Date() });
    const auth = new AuthenticateRequest(world.identity, world.users);
    expect(await auth.authenticate(world.identity.issue('clerk_gone'))).toBeNull();
    expect(await auth.authenticate('not-a-token')).toBeNull();
  });
});
