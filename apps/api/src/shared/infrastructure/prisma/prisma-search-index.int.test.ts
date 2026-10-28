import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  searchIndexContract,
  sampleSearchEntry,
} from '../../../../test/support/contracts/search-index.contract';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaSearchIndex, SEARCH_BODY_MAX_CHARS, truncateBody } from './prisma-search-index';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { TransactionHost } from './transaction-host';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const index = new PrismaSearchIndex(host);

beforeAll(() => truncateBusinessTables(admin));
afterAll(async () => {
  await service.client.$disconnect();
  await admin.$disconnect();
});

searchIndexContract('Prisma', async () => {
  await truncateBusinessTables(admin);
  return {
    uow,
    index,
    read: async (entityType, entityId) => {
      const row = await admin.searchEntry.findUnique({
        where: { entityType_entityId: { entityType, entityId } },
      });
      return row
        ? {
            entityType: row.entityType,
            entityId: row.entityId,
            code: row.code,
            title: row.title,
            subtitle: row.subtitle,
            body: row.body,
            status: row.status,
            archived: row.archived,
          }
        : null;
    },
    count: () => admin.searchEntry.count(),
  };
});

describe('PrismaSearchIndex body', () => {
  it('truncates the body to the documented cap and strips NUL characters', async () => {
    await truncateBusinessTables(admin);
    await uow.run(() =>
      index.upsert({
        ...sampleSearchEntry('big'),
        title: 'a\u0000b',
        body: 'x'.repeat(SEARCH_BODY_MAX_CHARS + 500),
      }),
    );
    const row = await admin.searchEntry.findFirstOrThrow({ where: { entityId: 'big' } });
    expect(row.body).toHaveLength(SEARCH_BODY_MAX_CHARS);
    expect(row.title).toBe('ab');
  });

  it('does not split a surrogate pair when cutting', () => {
    const body = 'a'.repeat(9) + '😀';
    expect(truncateBody(body, 10)).toBe('a'.repeat(9));
    expect(truncateBody('short', 10)).toBe('short');
  });
});
