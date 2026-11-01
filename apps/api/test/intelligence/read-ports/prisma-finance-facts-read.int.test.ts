import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaFinanceFactsRead } from '../../../src/modules/intelligence/infrastructure/prisma-finance-facts-read';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { dateOnlyToDbDate } from '../../../src/shared/infrastructure/prisma/decimal-mapper';
import { financeFactsReadContract } from '../../support/contracts/finance-facts-read.contract';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);

beforeAll(() => truncateBusinessTables(admin));
afterAll(async () => {
  await service.client.$disconnect();
  await admin.$disconnect();
});

async function reset(): Promise<void> {
  await truncateBusinessTables(admin);
  // ExpenseCategory is a seeded catalog that truncate keeps: drop the rows this spec made.
  await admin.expenseCategory.deleteMany({ where: { id: { startsWith: 'cat-' } } });
}

async function ensureClient(id: string, extra: { tradeName?: string; deletedAt?: Date } = {}) {
  await admin.client.upsert({
    where: { id },
    update: {},
    create: {
      id,
      code: `CLI-${id}`,
      kind: 'EMPRESA',
      tradeName: extra.tradeName ?? id,
      legalName: id,
      taxId: id,
      country: 'US',
      address: 'x',
      phone: '1',
      ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {}),
    },
  });
}

async function ensureProject(id: string) {
  await admin.project.upsert({
    where: { id },
    update: {},
    create: { id, code: `PRJ-${id}`, name: id, summary: 's' },
  });
}

financeFactsReadContract('Prisma', async () => {
  await reset();
  return {
    port: new PrismaFinanceFactsRead(host),
    addFact: async (fact) => {
      await admin.financeFact.create({
        data: {
          kind: fact.kind,
          date: dateOnlyToDbDate(fact.date),
          amountUsd: fact.amountUsd,
          clientId: fact.clientId ?? null,
          projectId: fact.projectId ?? null,
          accountId: fact.accountId ?? null,
          categoryId: fact.categoryId ?? null,
          methodId: fact.methodId ?? null,
          invoiceId: fact.invoiceId ?? null,
          ivaRate: fact.ivaRate ?? null,
          dueDate: fact.dueDate ? dateOnlyToDbDate(fact.dueDate) : null,
          sourceType: 'INVOICE',
          sourceId: fact.invoiceId ?? 'src',
        },
      });
    },
    tag: async (tagId, assigned) => {
      await admin.tag.create({ data: { id: tagId, name: tagId, color: '#000000' } });
      for (const clientId of assigned.clientIds ?? []) {
        await ensureClient(clientId);
        await admin.tagAssignment.create({ data: { tagId, clientId } });
      }
      for (const projectId of assigned.projectIds ?? []) {
        await ensureProject(projectId);
        await admin.tagAssignment.create({ data: { tagId, projectId } });
      }
    },
    addCategory: async (id, parentId) => {
      await admin.expenseCategory.create({ data: { id, name: id, parentId: parentId ?? null } });
    },
  };
});

describe('Prisma read ports inside a unit of work', () => {
  it('read the transaction in progress', async () => {
    await reset();
    const uow = new PrismaUnitOfWork(host);
    const port = new PrismaFinanceFactsRead(host);
    const seen = await uow.run(async () => {
      await host.db.financeFact.create({
        data: {
          kind: 'BILLED',
          date: dateOnlyToDbDate('2026-06-02'),
          amountUsd: '12.34',
          sourceType: 'INVOICE',
          sourceId: 'uncommitted',
        },
      });
      return (await port.sumByKind({ from: '2026-06-01', to: '2026-06-30' })).BILLED;
    });
    expect(seen).toBe('12.34');
  });
});
