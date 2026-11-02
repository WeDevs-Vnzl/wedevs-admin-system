import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import type { ApiTokenRecord } from '../../../src/modules/identity/application/ports/api-token.repository.port';
import { AuthenticateApiToken } from '../../../src/modules/identity/application/use-cases/api-tokens/authenticate-api-token.use-case';
import { IssueApiToken } from '../../../src/modules/identity/application/use-cases/api-tokens/issue-api-token.use-case';
import { RevokeApiToken } from '../../../src/modules/identity/application/use-cases/api-tokens/revoke-api-token.use-case';
import { NodeApiTokenSecrets } from '../../../src/modules/identity/infrastructure/api-token-authenticator-secrets';
import { PrismaApiTokenRepository } from '../../../src/modules/identity/infrastructure/prisma-api-token.repository';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const repo = new PrismaApiTokenRepository(host);
const uow = new PrismaUnitOfWork(host);
const activity = new PrismaActivityLog(host);
const secrets = new NodeApiTokenSecrets();
const clock = new FixedClock('2026-03-01T10:00:00.000Z');

const issue = new IssueApiToken(
  uow,
  repo,
  secrets,
  activity,
  clock,
  new SequentialIdGenerator('tok_int'),
);
const revoke = new RevokeApiToken(uow, repo, activity, clock);
const authenticate = new AuthenticateApiToken(repo, secrets, clock);

const actorOf = (id: string) => ({
  userId: id,
  clerkId: `clerk_${id}`,
  role: 'ADMIN' as const,
  email: `${id}@example.com`,
  name: id,
});

async function seedUser(
  id: string,
  deletedAt: Date | null = null,
  role: 'ADMIN' | 'OWNER' = 'ADMIN',
) {
  await admin.user.create({
    data: { id, clerkId: `clerk_${id}`, email: `${id}@example.com`, name: id, role, deletedAt },
  });
}

async function clean(): Promise<void> {
  await admin.activityLog.deleteMany();
  await admin.apiToken.deleteMany();
  await admin.user.deleteMany();
}

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
beforeEach(async () => {
  await clean();
  clock.set('2026-03-01T10:00:00.000Z');
});
afterAll(async () => {
  await clean();
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaApiTokenRepository (int)', () => {
  it('stores only the SHA-256 and the 12-char prefix, never the secret', async () => {
    await seedUser('u1');
    const out = await issue.execute(actorOf('u1'), { name: 'ci', expiresInDays: 30 });
    const row = await admin.apiToken.findUniqueOrThrow({ where: { id: out.id } });
    expect(row.tokenHash).toBe(secrets.hash(out.secret));
    expect(row.prefix).toBe(out.secret.slice(0, 12));
    expect(JSON.stringify(row)).not.toContain(out.secret);
    const log = await admin.activityLog.findFirstOrThrow({ where: { entityId: out.id } });
    expect(log).toMatchObject({ action: 'CREATE', entityType: 'API_TOKEN', actorType: 'USER' });
    expect(JSON.stringify(log)).not.toContain(out.secret);
  });

  it('authenticates a valid token to the DB role and refuses revoked, expired and archived-owner tokens', async () => {
    await seedUser('u1', null, 'OWNER');
    await seedUser('u2');
    const good = await issue.execute(actorOf('u1'), { name: 'good' });
    const revoked = await issue.execute(actorOf('u1'), { name: 'revoked' });
    const archived = await issue.execute(actorOf('u2'), { name: 'archived' });
    await revoke.execute(actorOf('u1'), { id: revoked.id });
    await admin.user.update({ where: { id: 'u2' }, data: { deletedAt: new Date() } });

    expect(await authenticate.execute(good.secret)).toMatchObject({ userId: 'u1', role: 'OWNER' });
    expect(await authenticate.execute(revoked.secret)).toBeNull();
    expect(await authenticate.execute(archived.secret)).toBeNull();
    expect(await authenticate.execute(`wdc_pat_${'z'.repeat(43)}`)).toBeNull();
    clock.advance(91 * 86_400_000);
    expect(await authenticate.execute(good.secret)).toBeNull();
  });

  it('writes lastUsedAt at most once a minute', async () => {
    await seedUser('u1');
    const t = await issue.execute(actorOf('u1'), { name: 'a' });
    const read = async () =>
      (await admin.apiToken.findUniqueOrThrow({ where: { id: t.id } })).lastUsedAt;
    await authenticate.execute(t.secret);
    const first = await read();
    expect(first).toEqual(clock.now());
    clock.advance(30_000);
    await authenticate.execute(t.secret);
    expect(await read()).toEqual(first);
    clock.advance(30_000);
    await authenticate.execute(t.secret);
    expect(await read()).toEqual(clock.now());
  });

  it('counts only active tokens, lists own newest first and scopes findOwned by user', async () => {
    await seedUser('u1');
    await seedUser('u2');
    const a = await issue.execute(actorOf('u1'), { name: 'a', expiresInDays: 1 });
    clock.advance(1000);
    const b = await issue.execute(actorOf('u1'), { name: 'b' });
    await issue.execute(actorOf('u2'), { name: 'c' });
    expect((await repo.listByUser('u1')).map((r: ApiTokenRecord) => r.id)).toEqual([b.id, a.id]);
    expect(await repo.findOwned(a.id, 'u2')).toBeNull();
    expect(await repo.countActive('u1', clock.now())).toBe(2);
    clock.advance(2 * 86_400_000);
    expect(await repo.countActive('u1', clock.now())).toBe(1);
    await revoke.execute(actorOf('u1'), { id: b.id });
    expect(await repo.countActive('u1', clock.now())).toBe(0);
  });

  it('keeps the limit of 10 active tokens under concurrent issuance', async () => {
    await seedUser('u1');
    for (let i = 0; i < 9; i += 1) await issue.execute(actorOf('u1'), { name: `t${i}` });
    const results = await Promise.allSettled([
      issue.execute(actorOf('u1'), { name: 'race1' }),
      issue.execute(actorOf('u1'), { name: 'race2' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await admin.apiToken.count({ where: { userId: 'u1' } })).toBe(10);
  });
});
