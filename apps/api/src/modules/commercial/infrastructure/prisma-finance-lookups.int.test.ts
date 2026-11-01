import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { FinanceLookups } from '../application/finance-lookups';
import { PrismaFinanceLookups } from './prisma-finance-lookups';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const lookups = new FinanceLookups(new PrismaFinanceLookups(new TransactionHost(service)));

const ids = { live: '', archived: '', other: '', p1: '', p2: '', p3: '', user: '', gone: '' };

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  const client = async (code: string, tradeName: string, deletedAt: Date | null) =>
    (
      await admin.client.create({
        data: {
          code,
          kind: 'EMPRESA',
          tradeName,
          legalName: `${tradeName} SA`,
          taxId: code,
          country: 'VE',
          address: 'x',
          phone: '1',
          deletedAt,
        },
      })
    ).id;
  const project = async (code: string, clientIds: string[], deletedAt: Date | null) =>
    (
      await admin.project.create({
        data: {
          code,
          name: `Name ${code}`,
          summary: 's',
          deletedAt,
          clients: { create: clientIds.map((clientId) => ({ clientId })) },
        },
      })
    ).id;
  ids.live = await client('CLI-0001', 'Kairos', null);
  ids.archived = await client('CLI-0002', 'Viejo', new Date());
  ids.other = await client('CLI-0003', 'Otro', null);
  ids.p1 = await project('PRY-0001', [ids.live], null);
  ids.p2 = await project('PRY-0002', [ids.live, ids.other], null);
  ids.p3 = await project('PRY-0003', [ids.live], new Date());
  ids.user = (
    await admin.user.create({
      data: { clerkId: 'ck_1', email: 'a@x.test', name: 'Ana', role: 'OWNER' },
    })
  ).id;
  ids.gone = (
    await admin.user.create({
      data: { clerkId: 'ck_2', email: 'b@x.test', name: 'Gone', deletedAt: new Date() },
    })
  ).id;
});
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaFinanceLookups (int)', { timeout: 120_000 }, () => {
  it('resolves a live client and rejects archived and unknown ids', async () => {
    expect(await lookups.liveClientRef(ids.live)).toEqual({
      type: 'CLIENT',
      id: ids.live,
      code: 'CLI-0001',
      label: 'Kairos',
    });
    expect(await lookups.liveClientRef(ids.archived)).toBeNull();
    expect(await lookups.liveClientRef('missing')).toBeNull();
  });

  it('resolves a live project with its clients and rejects archived and unknown ids', async () => {
    const found = await lookups.liveProject(ids.p2);
    expect(found?.ref).toEqual({
      type: 'PROJECT',
      id: ids.p2,
      code: 'PRY-0002',
      label: 'Name PRY-0002',
    });
    expect(found?.status).toBe('PROPUESTA');
    expect([...(found?.clientIds ?? [])].sort()).toEqual([ids.live, ids.other].sort());
    expect(await lookups.liveProject(ids.p3)).toBeNull();
    expect(await lookups.liveProject('missing')).toBeNull();
  });

  it('checks that a live project belongs to a client', async () => {
    expect(await lookups.projectBelongsToClient(ids.p1, ids.live)).toBe(true);
    expect(await lookups.projectBelongsToClient(ids.p1, ids.other)).toBe(false);
    expect(await lookups.projectBelongsToClient(ids.p3, ids.live)).toBe(false);
  });

  it('lists the live projects of a client by code', async () => {
    const found = await lookups.liveProjectsOfClient(ids.live);
    expect(found.map((p) => p.ref.id)).toEqual([ids.p1, ids.p2]);
    expect(await lookups.liveProjectsOfClient(ids.archived)).toEqual([]);
  });

  it('resolves an active partner and rejects a deleted or unknown user', async () => {
    expect(await lookups.partnerRef(ids.user)).toEqual({
      id: ids.user,
      label: 'Ana',
      role: 'OWNER',
    });
    expect(await lookups.partnerRef(ids.gone)).toBeNull();
    expect(await lookups.partnerRef('missing')).toBeNull();
  });
});
