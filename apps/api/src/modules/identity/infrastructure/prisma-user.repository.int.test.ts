import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../shared/domain/list-query';
import { PrismaActivityLog } from '../../../shared/infrastructure/prisma/prisma-activity-log';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaLoginActivityRepository } from './prisma-login-activity.repository';
import { PrismaUserPreferenceRepository } from './prisma-user-preference.repository';
import { PrismaUserRepository } from './prisma-user.repository';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const users = new PrismaUserRepository(host);
const prefs = new PrismaUserPreferenceRepository(host);
const logins = new PrismaLoginActivityRepository(host);
const uow = new PrismaUnitOfWork(host);
const activity = new PrismaActivityLog(host);

const NOW = new Date('2026-02-01T10:00:00.000Z');
const query = (over: Partial<ListQuery> = {}): ListQuery => ({ ...DEFAULT_LIST_QUERY, ...over });
const newUser = (n: number, over: Record<string, unknown> = {}) => ({
  id: `usr_int_${n}`,
  clerkId: `clerk_int_${n}`,
  email: `User${n}@Example.com`.toLowerCase(),
  name: `User ${n}`,
  imageUrl: null,
  role: 'VIEWER' as const,
  now: NOW,
  ...over,
});

/** Cheap per-test reset of the only tables this suite writes (a full truncate is slow on a shared box). */
async function clean(): Promise<void> {
  await admin.activityLog.deleteMany();
  await admin.user.deleteMany();
}

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
beforeEach(clean);
afterAll(async () => {
  await clean();
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaUserRepository (int)', () => {
  it('insertIfAbsent returns null on a duplicate clerk id without aborting the transaction', async () => {
    await users.insert(newUser(1));
    const result = await uow.run(async () => {
      const dup = await users.insertIfAbsent(newUser(2, { clerkId: 'clerk_int_1' }));
      const fresh = await users.insertIfAbsent(newUser(3));
      return { dup, fresh };
    });
    expect(result.dup).toBeNull();
    expect(result.fresh?.id).toBe('usr_int_3');
    expect(await users.findAnyByClerkId('clerk_int_2')).toBeNull();
  });

  it('inserts and reads by id, clerk id and e-mail (case-insensitive)', async () => {
    const created = await users.insert(newUser(1, { role: 'OWNER', imageUrl: 'https://i/x.png' }));
    expect(created).toMatchObject({
      id: 'usr_int_1',
      role: 'OWNER',
      imageUrl: 'https://i/x.png',
      deletedAt: null,
    });
    expect(created.createdAt).toEqual(NOW);
    expect(await users.findActiveById('usr_int_1')).toMatchObject({ clerkId: 'clerk_int_1' });
    expect(await users.findActiveByClerkId('clerk_int_1')).toMatchObject({ id: 'usr_int_1' });
    expect(await users.findActiveByEmail('USER1@example.COM')).toMatchObject({ id: 'usr_int_1' });
    expect(await users.findActiveById('nope')).toBeNull();
  });

  it('soft delete hides the user from active reads but findAny* still sees it (C19)', async () => {
    await users.insert(newUser(1));
    await users.softDelete('usr_int_1', NOW);
    expect(await users.findActiveById('usr_int_1')).toBeNull();
    expect(await users.findActiveByClerkId('clerk_int_1')).toBeNull();
    expect(await users.findActiveByEmail('user1@example.com')).toBeNull();
    expect(await users.findAnyByClerkId('clerk_int_1')).toMatchObject({ id: 'usr_int_1' });
    expect(await users.findAnyByEmail('user1@example.com')).toMatchObject({ id: 'usr_int_1' });
    expect(await users.countActiveOwners()).toBe(0);
  });

  it('counts only active owners', async () => {
    await users.insert(newUser(1, { role: 'OWNER' }));
    await users.insert(newUser(2, { role: 'OWNER' }));
    await users.insert(newUser(3, { role: 'ADMIN' }));
    expect(await users.countActiveOwners()).toBe(2);
    await users.softDelete('usr_int_2', NOW);
    expect(await users.countActiveOwners()).toBe(1);
  });

  it('updates role and profile', async () => {
    await users.insert(newUser(1));
    const later = new Date('2026-03-01T00:00:00.000Z');
    expect(await users.updateRole('usr_int_1', 'ADMIN', later)).toMatchObject({
      role: 'ADMIN',
      updatedAt: later,
    });
    expect(
      await users.updateProfile('usr_int_1', {
        email: 'new@example.com',
        name: 'New',
        imageUrl: null,
        now: later,
      }),
    ).toMatchObject({ email: 'new@example.com', name: 'New', role: 'ADMIN' });
  });

  it('lists with the SQL search path combined with a role filter (first consumer of sqlWhere)', async () => {
    await users.insert(
      newUser(1, { name: 'Andrés Molina', email: 'andres@example.com', role: 'OWNER' }),
    );
    await users.insert(
      newUser(2, { name: 'Camila Torres', email: 'camila.torres@example.com', role: 'ADMIN' }),
    );
    await users.insert(
      newUser(3, { name: 'Camilo Vega', email: 'camilo@example.com', role: 'VIEWER' }),
    );

    const all = await users.list(query());
    expect(all.items.map((u) => u.name)).toEqual(['Andrés Molina', 'Camila Torres', 'Camilo Vega']);
    expect(all).toMatchObject({ total: 3, page: 1, pageCount: 1 });

    const folded = await users.list(query({ q: 'ANDRES' }));
    expect(folded.items.map((u) => u.id)).toEqual(['usr_int_1']);

    const searchAndRole = await users.list(
      query({ q: 'cami', filters: { role: ['ADMIN', 'OWNER'] } }),
    );
    expect(searchAndRole.items.map((u) => u.id)).toEqual(['usr_int_2']);
    expect(searchAndRole.total).toBe(1);

    const byRole = await users.list(query({ filters: { role: 'VIEWER' } }));
    expect(byRole.items.map((u) => u.id)).toEqual(['usr_int_3']);

    const sorted = await users.list(query({ sort: { field: 'role', direction: 'desc' } }));
    // Postgres orders an enum by declaration (OWNER, ADMIN, MEMBER, VIEWER): the privilege order.
    expect(sorted.items.map((u) => u.role)).toEqual(['VIEWER', 'ADMIN', 'OWNER']);
  });

  it('archived modes and paging', async () => {
    for (let n = 1; n <= 3; n++) await users.insert(newUser(n));
    await users.softDelete('usr_int_3', NOW);
    expect((await users.list(query())).total).toBe(2);
    expect((await users.list(query({ archived: 'only' }))).items.map((u) => u.id)).toEqual([
      'usr_int_3',
    ]);
    expect((await users.list(query({ archived: 'include' }))).total).toBe(3);
    expect(
      (await users.list(query({ archived: 'only', q: 'user' }))).items.map((u) => u.id),
    ).toEqual(['usr_int_3']);
  });

  it('a unique violation on clerk id or e-mail surfaces as an error', async () => {
    await users.insert(newUser(1));
    await expect(users.insert(newUser(1, { id: 'usr_other' }))).rejects.toBeDefined();
  });
});

describe('PrismaUserPreferenceRepository (int)', () => {
  it('upserts per (user, key), lists own rows only and removes by key', async () => {
    await users.insert(newUser(1));
    await users.insert(newUser(2));
    await prefs.upsert('usr_int_1', 'theme', 'dark');
    await prefs.upsert('usr_int_1', 'theme', 'light');
    await prefs.upsert('usr_int_1', 'table:clients:columns', {
      order: ['a'],
      visibility: {},
      widths: {},
    });
    await prefs.upsert('usr_int_2', 'theme', 'dark');

    expect(await prefs.listByUser('usr_int_1')).toEqual([
      { key: 'table:clients:columns', value: { order: ['a'], visibility: {}, widths: {} } },
      { key: 'theme', value: 'light' },
    ]);
    await prefs.remove('usr_int_1', 'theme');
    await prefs.remove('usr_int_1', 'never-stored');
    expect((await prefs.listByUser('usr_int_1')).map((r) => r.key)).toEqual([
      'table:clients:columns',
    ]);
    expect(await prefs.listByUser('usr_int_2')).toEqual([{ key: 'theme', value: 'dark' }]);
  });
});

describe('PrismaLoginActivityRepository (int)', () => {
  const login = (svixId: string) =>
    uow.run(async () => {
      if (await logins.existsForEvent(svixId)) return 'duplicate';
      await activity.record({
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'LOGIN',
        entityType: 'USER',
        entityId: 'usr_x',
        entityLabel: 'X',
        metadata: { svixId },
      });
      return 'recorded';
    });

  it('finds a LOGIN entry by metadata.svixId and nothing else', async () => {
    expect(await login('msg_1')).toBe('recorded');
    expect(await login('msg_1')).toBe('duplicate');
    expect(await login('msg_2')).toBe('recorded');
    expect(await admin.activityLog.count({ where: { action: 'LOGIN' } })).toBe(2);
  });

  it('is atomic under concurrent deliveries of the same event: exactly one entry', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => login('msg_race')));
    expect(results.filter((r) => r === 'recorded')).toHaveLength(1);
    expect(await admin.activityLog.count({ where: { action: 'LOGIN' } })).toBe(1);
  });

  it('requires a unit of work', async () => {
    await expect(logins.existsForEvent('msg_1')).rejects.toThrow(/unit of work/);
  });
});
