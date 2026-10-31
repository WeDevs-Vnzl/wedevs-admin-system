import { afterAll, describe, expect, it } from 'vitest';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { PrismaService } from './prisma.service';
import { TransactionHost } from './transaction-host';

const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);

afterAll(() => service.client.$disconnect());

const sleepFor = (seconds: number) => () =>
  host.db.$queryRaw`SELECT 1 AS one FROM pg_sleep(${seconds})`;

describe('PrismaUnitOfWork transaction timeout', () => {
  it('rolls back a unit of work that outlives its requested timeout', async () => {
    await expect(uow.run(sleepFor(1.5), { timeoutMs: 400 })).rejects.toMatchObject({
      code: expect.stringMatching(/P2028|P2034/),
    });
  });

  it('lets a unit of work run as long as the timeout it asked for allows', async () => {
    await expect(uow.run(sleepFor(1.5), { timeoutMs: 20_000 })).resolves.toBeDefined();
  });
});
