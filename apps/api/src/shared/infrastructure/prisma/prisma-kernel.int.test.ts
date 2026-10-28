import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activityLogContract } from '../../../../test/support/contracts/activity-log.contract';
import { sequenceContract } from '../../../../test/support/contracts/sequence.contract';
import {
  sampleEntry,
  unitOfWorkContract,
  type KernelHarness,
} from '../../../../test/support/contracts/unit-of-work.contract';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { ConflictError } from '../../domain/domain-error';
import { PrismaActivityLog } from './prisma-activity-log';
import { PrismaSequence } from './prisma-sequence';
import { isSerializationFailure, PrismaUnitOfWork } from './prisma-unit-of-work';
import { PrismaService } from './prisma.service';
import { TransactionHost } from './transaction-host';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const activityLog = new PrismaActivityLog(host);
const sequence = new PrismaSequence(host);

async function harness(): Promise<KernelHarness> {
  await truncateBusinessTables(admin);
  return {
    uow,
    activityLog,
    sequence,
    readActivity: async () => {
      const rows = await admin.activityLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((r) => ({
        actor: { actorType: r.actorType, userId: r.actorId },
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        entityLabel: r.entityLabel,
        clientId: r.clientId,
        changes: r.changes as Record<string, unknown> | null,
        metadata: r.metadata as Record<string, unknown> | null,
      }));
    },
  };
}

beforeAll(async () => {
  await truncateBusinessTables(admin);
});
afterAll(async () => {
  await service.client.$disconnect();
  await admin.$disconnect();
});

unitOfWorkContract('Prisma', harness);
activityLogContract('Prisma', harness);
sequenceContract('Prisma', harness, async (_h, name, value) => {
  await admin.sequence.update({ where: { name }, data: { value } });
});

describe('PrismaUnitOfWork', () => {
  beforeEach(async () => {
    await truncateBusinessTables(admin);
  });

  it('rollback leaves neither the row nor its activity entry', async () => {
    await expect(
      uow.run(async () => {
        await host.db.client.create({
          data: {
            code: 'CLI-9999',
            kind: 'PERSONA',
            tradeName: 'Ghost',
            legalName: 'Ghost',
            taxId: 'V-1',
            country: 'VE',
            address: 'x',
            phone: '1',
          },
        });
        await activityLog.record(sampleEntry('ghost'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await admin.client.count({ where: { tradeName: 'Ghost' } })).toBe(0);
    expect(await admin.activityLog.count()).toBe(0);
  });

  it('runs at the requested isolation level', async () => {
    const level = async () =>
      (await host.db.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`)[0]
        ?.transaction_isolation;
    expect(await uow.run(level, { isolation: 'Serializable' })).toBe('serializable');
    expect(await uow.run(level)).toBe('read committed');
    expect(await uow.run(level, { isolation: 'RepeatableRead' })).toBe('repeatable read');
  });

  it('retries the whole work on a serialization failure, up to 3 attempts', async () => {
    let attempts = 0;
    const result = await uow.run(
      async () => {
        attempts++;
        if (attempts < 3)
          throw Object.assign(new Error('could not serialize access'), { code: 'P2034' });
        return 'ok';
      },
      { isolation: 'Serializable' },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('surfaces CONFLICT after the third failed attempt', async () => {
    let attempts = 0;
    const failing = uow.run(
      async () => {
        attempts++;
        throw Object.assign(new Error('x'), { code: 'P2034' });
      },
      { isolation: 'Serializable' },
    );
    await expect(failing).rejects.toBeInstanceOf(ConflictError);
    await expect(failing).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(attempts).toBe(3);
  });

  it('does not retry outside Serializable (still CONFLICT) nor non-serialization errors', async () => {
    let attempts = 0;
    await expect(
      uow.run(async () => {
        attempts++;
        throw Object.assign(new Error('x'), { code: 'P2034' });
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(attempts).toBe(1);
    const other = new Error('plain');
    await expect(
      uow.run(
        async () => {
          throw other;
        },
        { isolation: 'Serializable' },
      ),
    ).rejects.toBe(other);
  });

  it('detects a real write-skew conflict and recovers by retrying', async () => {
    const barrier = (() => {
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      return async () => {
        if (++arrived >= 2) release();
        await Promise.race([gate, new Promise((r) => setTimeout(r, 1500))]);
      };
    })();
    let attempts = 0;
    const work = (id: string) => {
      let own = 0;
      return async () => {
        attempts++;
        own++;
        const seen = await host.db.activityLog.count();
        if (own === 1) await barrier();
        await activityLog.record({ ...sampleEntry(id), entityLabel: `saw ${seen}` });
      };
    };
    await Promise.all([
      uow.run(work('a'), { isolation: 'Serializable' }),
      uow.run(work('b'), { isolation: 'Serializable' }),
    ]);
    expect(await admin.activityLog.count()).toBe(2);
    expect(attempts).toBeGreaterThan(2);
  });

  it('classifies serialization errors by code, message or cause', () => {
    expect(isSerializationFailure({ code: 'P2034' })).toBe(true);
    expect(isSerializationFailure({ cause: { code: '40001' } })).toBe(true);
    expect(
      isSerializationFailure({
        cause: { originalCode: '40001', kind: 'TransactionWriteConflict' },
      }),
    ).toBe(true);
    expect(isSerializationFailure(new Error('could not serialize access due to x'))).toBe(true);
    expect(isSerializationFailure(new Error('boom'))).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
  });
});

describe('PrismaActivityLog / PrismaSequence', () => {
  beforeEach(async () => {
    await truncateBusinessTables(admin);
  });

  it('rejects an unknown sequence name', async () => {
    await expect(uow.run(() => sequence.next('XXX' as never))).rejects.toThrow(/Unknown sequence/);
  });

  it('20 concurrent units of work yield CLI-0001..CLI-0020 with no duplicates or gaps', async () => {
    const codes = await Promise.all(
      Array.from({ length: 20 }, () =>
        uow.run(async () => {
          const code = await sequence.next('CLI');
          await activityLog.record(sampleEntry(code));
          return code;
        }),
      ),
    );
    const expected = Array.from({ length: 20 }, (_, i) => `CLI-${String(i + 1).padStart(4, '0')}`);
    expect([...codes].sort()).toEqual(expected);
    expect((await admin.sequence.findUniqueOrThrow({ where: { name: 'CLI' } })).value).toBe(20);
  });

  it('a rolled-back allocation does not consume a value', async () => {
    await expect(
      uow.run(async () => {
        await sequence.next('PAG');
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(await uow.run(() => sequence.next('PAG'))).toBe('PAG-0001');
  });

  it('exposes no update or delete on the activity log (C20)', () => {
    expect(Object.getOwnPropertyNames(PrismaActivityLog.prototype).sort()).toEqual([
      'constructor',
      'record',
    ]);
  });
});
