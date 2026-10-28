import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaHealthProbe } from './prisma-health-probe.adapter';

describe('PrismaHealthProbe (int)', () => {
  let service: PrismaService;

  beforeAll(() => {
    const url = assertLocalDatabaseUrl(process.env.DATABASE_URL);
    service = new PrismaService({ DATABASE_URL: url });
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('resolves when the database answers', async () => {
    const probe = new PrismaHealthProbe(new TransactionHost(service));
    await expect(probe.checkDatabase()).resolves.toBeUndefined();
  });

  it('rejects when the database is unreachable', async () => {
    const dead = new PrismaService({
      DATABASE_URL: 'postgresql://postgres:dev@localhost:1/core',
    });
    const probe = new PrismaHealthProbe(new TransactionHost(dead));
    await expect(probe.checkDatabase()).rejects.toBeDefined();
    await dead.onModuleDestroy();
  });
});
