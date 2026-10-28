import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../../shared/domain/list-query';
import { createWorld, seedUser, type World } from '../../../../../test/identity/world';
import { makeUser } from '../../../../../test/identity/fakes/in-memory-user.repository';
import { ChangeUserRole } from './change-user-role.use-case';
import { GetCurrentUser } from './get-current-user.use-case';
import { GetUser } from './get-user.use-case';
import { InviteUser } from './invite-user.use-case';
import { ListInvitations } from './list-invitations.use-case';
import { ListUsers } from './list-users.use-case';
import { RevokeInvitation } from './revoke-invitation.use-case';

const NON_OWNERS = ['ADMIN', 'MEMBER', 'VIEWER'] as const;
const query = (over: Partial<ListQuery> = {}): ListQuery => ({ ...DEFAULT_LIST_QUERY, ...over });

function build(world: World) {
  return {
    list: new ListUsers(world.authorization, world.users),
    get: new GetUser(world.authorization, world.users),
    me: new GetCurrentUser(world.users),
    change: new ChangeUserRole(
      world.authorization,
      world.users,
      world.uow,
      world.activity,
      world.clock,
      world.identity,
      world.diagnostics,
    ),
    invite: new InviteUser(
      world.authorization,
      world.users,
      world.identity,
      world.uow,
      world.activity,
      world.diagnostics,
    ),
    invitations: new ListInvitations(world.authorization, world.identity),
    revoke: new RevokeInvitation(world.authorization, world.identity, world.uow, world.activity),
  };
}

describe('HU-02 CA1: only the Owner manages users', () => {
  it('lists the users for the Owner', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    seedUser(world, 'ADMIN');
    const page = await build(world).list.execute(owner.actor, query());
    expect(page.total).toBe(2);
    expect(page.items.map((row) => row.role)).toEqual(['ADMIN', 'OWNER']);
    expect(page.items[0]).not.toHaveProperty('clerkId');
  });

  it.each(NON_OWNERS)(
    'refuses %s (FORBIDDEN) on every users use case and changes nothing',
    async (role) => {
      const world = createWorld();
      const { actor } = seedUser(world, role);
      const target = seedUser(world, 'MEMBER', {
        id: 'usr_target',
        clerkId: 'clerk_target',
        email: 't@example.com',
      });
      const uc = build(world);

      await expect(uc.list.execute(actor, query())).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(uc.invitations.execute(actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(uc.get.execute(actor, { id: target.row.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        uc.invite.execute(actor, { email: 'new@example.com', role: 'ADMIN' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        uc.change.execute(actor, { userId: target.row.id, role: 'ADMIN' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(uc.revoke.execute(actor, { invitationId: 'inv_1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      expect(world.users.byId(target.row.id)?.role).toBe('MEMBER');
      expect(world.identity.invitations.size).toBe(0);
      expect(world.activity.entries).toHaveLength(0);
    },
  );
});

describe('ListUsers', () => {
  it('filters by role, searches name or e-mail (accent-folded) and sorts', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER', { name: 'Andrés Molina', email: 'andres@example.com' });
    seedUser(world, 'ADMIN', { name: 'Camila Torres', email: 'camila.torres@example.com' });
    seedUser(world, 'VIEWER', { name: 'Zoe', email: 'zoe@example.com' });
    const { list } = build(world);

    const owners = await list.execute(owner.actor, query({ filters: { role: ['OWNER'] } }));
    expect(owners.items.map((r) => r.name)).toEqual(['Andrés Molina']);
    const search = await list.execute(owner.actor, query({ q: 'camila.torres' }));
    expect(search.items.map((r) => r.name)).toEqual(['Camila Torres']);
    const folded = await list.execute(owner.actor, query({ q: 'andres' }));
    expect(folded.total).toBe(1);
    const byRoleDesc = await list.execute(
      owner.actor,
      query({ sort: { field: 'role', direction: 'desc' } }),
    );
    expect(byRoleDesc.items.map((r) => r.role)).toEqual(['VIEWER', 'ADMIN', 'OWNER']);
  });

  it('excludes archived users by default and returns them with archived=only', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    world.users.seed(
      makeUser({
        id: 'usr_old',
        clerkId: 'c_old',
        email: 'old@example.com',
        deletedAt: new Date(),
      }),
    );
    const { list } = build(world);
    expect((await list.execute(owner.actor, query())).total).toBe(1);
    expect(
      (await list.execute(owner.actor, query({ archived: 'only' }))).items.map((r) => r.id),
    ).toEqual(['usr_old']);
  });
});

describe('GetUser / GetCurrentUser', () => {
  it('returns the detail to the Owner and to the user themself, FORBIDDEN otherwise', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    const camila = seedUser(world, 'ADMIN', {
      id: 'usr_camila',
      clerkId: 'c_camila',
      email: 'c@example.com',
    });
    const { get } = build(world);

    expect(await get.execute(owner.actor, { id: 'usr_camila' })).toMatchObject({
      id: 'usr_camila',
      role: 'ADMIN',
    });
    expect((await get.execute(camila.actor, { id: 'usr_camila' })).id).toBe('usr_camila');
    await expect(get.execute(camila.actor, { id: owner.row.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('an unknown or deleted user is NOT_FOUND', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    world.users.seed(
      makeUser({
        id: 'usr_old',
        clerkId: 'c_old',
        email: 'old@example.com',
        deletedAt: new Date(),
      }),
    );
    const { get } = build(world);
    await expect(get.execute(owner.actor, { id: 'usr_nobody' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(get.execute(owner.actor, { id: 'usr_old' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('/me returns the caller, and is 401 when the row is gone', async () => {
    const world = createWorld();
    const member = seedUser(world, 'MEMBER');
    const { me } = build(world);
    expect(await me.execute(member.actor)).toMatchObject({ id: member.row.id, role: 'MEMBER' });
    await expect(me.execute({ ...member.actor, userId: 'usr_ghost' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('ChangeUserRole', () => {
  it('changes the role, logs the diff in a Serializable unit of work and mirrors the metadata', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    seedUser(world, 'MEMBER', {
      id: 'usr_diego',
      clerkId: 'c_diego',
      email: 'd@example.com',
      name: 'Diego',
    });
    world.clock.set('2026-02-01T10:00:00.000Z');

    const detail = await build(world).change.execute(owner.actor, {
      userId: 'usr_diego',
      role: 'ADMIN',
    });

    expect(detail).toMatchObject({
      id: 'usr_diego',
      role: 'ADMIN',
      updatedAt: new Date('2026-02-01T10:00:00.000Z'),
    });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(world.activity.entries).toEqual([
      {
        actor: { actorType: 'USER', userId: owner.row.id },
        action: 'UPDATE',
        entityType: 'USER',
        entityId: 'usr_diego',
        entityLabel: 'Diego',
        changes: { role: ['MEMBER', 'ADMIN'] },
      },
    ]);
    expect(world.identity.roleMetadata.get('c_diego')).toBe('ADMIN');
  });

  it('never demotes the last Owner (INTEGRITY_LOCK) and writes nothing', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    const { change } = build(world);
    const error = await change
      .execute(owner.actor, { userId: owner.row.id, role: 'ADMIN' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'settings.users.errors.lastOwner',
    });
    expect(world.users.byId(owner.row.id)?.role).toBe('OWNER');
    expect(world.activity.entries).toHaveLength(0);
  });

  it('allows demoting an Owner while another remains', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    seedUser(world, 'OWNER', { id: 'usr_owner2', clerkId: 'c_o2', email: 'o2@example.com' });
    await build(world).change.execute(owner.actor, { userId: 'usr_owner2', role: 'ADMIN' });
    await expect(
      build(world).change.execute(owner.actor, { userId: owner.row.id, role: 'VIEWER' }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
  });

  it('records nothing and skips Clerk when the role does not change', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    seedUser(world, 'MEMBER', { id: 'usr_m', clerkId: 'c_m', email: 'm@example.com' });
    await build(world).change.execute(owner.actor, { userId: 'usr_m', role: 'MEMBER' });
    expect(world.activity.entries).toHaveLength(0);
    expect(world.identity.roleMetadata.size).toBe(0);
  });

  it('keeps the DB change and logs a warning when the Clerk mirror fails (PRD §4.2)', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    seedUser(world, 'MEMBER', { id: 'usr_m', clerkId: 'c_m', email: 'm@example.com' });
    world.identity.failSetRoleMetadata = true;
    const detail = await build(world).change.execute(owner.actor, {
      userId: 'usr_m',
      role: 'ADMIN',
    });
    expect(detail.role).toBe('ADMIN');
    expect(world.users.byId('usr_m')?.role).toBe('ADMIN');
    expect(world.diagnostics.warnings).toHaveLength(1);
    expect(JSON.stringify(world.diagnostics.warnings)).not.toContain('clerk down');
  });

  it('an unknown user is NOT_FOUND and an invalid role is VALIDATION', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    const { change } = build(world);
    await expect(
      change.execute(owner.actor, { userId: 'usr_nobody', role: 'ADMIN' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      change.execute(owner.actor, { userId: owner.row.id, role: 'GOD' as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('InviteUser', () => {
  it('creates the invitation (lower-cased e-mail) and records the CREATE activity', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    const invitation = await build(world).invite.execute(owner.actor, {
      email: ' Nueva@Example.com ',
      role: 'ADMIN',
    });

    expect(invitation).toMatchObject({ email: 'nueva@example.com', role: 'ADMIN' });
    expect(world.identity.invitations.size).toBe(1);
    expect(world.activity.entries).toMatchObject([
      {
        action: 'CREATE',
        entityType: 'USER',
        entityId: invitation.id,
        entityLabel: 'nueva@example.com',
        metadata: { invitation: true, role: 'ADMIN' },
      },
    ]);
    expect((await build(world).invitations.execute(owner.actor)).map((i) => i.id)).toEqual([
      invitation.id,
    ]);
  });

  it('refuses an e-mail that already is a local user (CONFLICT, field error) before calling Clerk', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER', { email: 'andres.molina@example.com' });
    await expect(
      build(world).invite.execute(owner.actor, {
        email: 'Andres.Molina@example.com',
        role: 'ADMIN',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { email: ['settings.users.errors.emailTaken'] },
    });
    expect(world.identity.invitations.size).toBe(0);
  });

  it('a duplicate pending invitation is a CONFLICT with the same field error', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    const { invite } = build(world);
    await invite.execute(owner.actor, { email: 'x@example.com', role: 'ADMIN' });
    await expect(
      invite.execute(owner.actor, { email: 'X@example.com', role: 'ADMIN' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { email: ['settings.users.errors.emailTaken'] },
    });
  });

  it('revokes the invitation and rethrows when the activity write fails', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    const boom = new Error('activity down');
    world.activity.record = () => Promise.reject(boom);
    await expect(
      build(world).invite.execute(owner.actor, { email: 'z@example.com', role: 'VIEWER' }),
    ).rejects.toBe(boom);
    expect(world.identity.invitations.size).toBe(0);
  });

  it('rejects an invalid role', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    await expect(
      build(world).invite.execute(owner.actor, { email: 'z@example.com', role: 'GOD' as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('RevokeInvitation', () => {
  it('revokes a pending invitation and logs it; an unknown one is NOT_FOUND', async () => {
    const world = createWorld();
    const owner = seedUser(world, 'OWNER');
    const uc = build(world);
    const invitation = await uc.invite.execute(owner.actor, {
      email: 'y@example.com',
      role: 'ADMIN',
    });

    await uc.revoke.execute(owner.actor, { invitationId: invitation.id });

    expect(world.identity.invitations.size).toBe(0);
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'DELETE',
      entityType: 'USER',
      entityLabel: 'y@example.com',
      metadata: { invitation: true },
    });
    await expect(
      uc.revoke.execute(owner.actor, { invitationId: invitation.id }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
