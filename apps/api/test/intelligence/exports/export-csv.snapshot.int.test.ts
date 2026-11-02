import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EXPORT_PAGE_SIZE,
  ExportCsv,
} from '../../../src/modules/intelligence/application/use-cases/exports/export-csv.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { ActivityLogPort } from '../../../src/shared/application/ports/activity-log.port';
import {
  ExportSourceRegistry,
  type ExportSource,
} from '../../../src/shared/application/ports/export-source.port';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FixedClock } from '../../support/fakes/fixed-clock';

/**
 * The export reads every page inside one RepeatableRead unit of work, so the file is one snapshot: a row
 * written or archived by someone else between two page reads is neither duplicated nor skipped.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);

const user: CurrentUser = {
  userId: 'usr_1',
  clerkId: 'clerk_1',
  role: 'OWNER',
  email: 'o@example.test',
  name: 'Owner',
};
const TOTAL = EXPORT_PAGE_SIZE + 50;
const nameOf = (i: number) => `t-${String(i).padStart(3, '0')}`;

afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await admin.tag.createMany({
    data: Array.from({ length: TOTAL }, (_, i) => ({
      id: `tag_${i}`,
      name: nameOf(i + 1),
      color: '#000',
    })),
  });
});

/** An offset-paged source over the real `Tag` table; `afterPage` is the test-only hook between two reads. */
function exporter(afterPage: (page: number) => Promise<void>) {
  const source: ExportSource<{ name: string }> = {
    entity: 'TAG',
    columns: { name: { type: 'text', value: (r) => r.name } },
    async read(_actor, _query, { page, pageSize }) {
      const rows = await host.db.tag.findMany({
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { name: true },
      });
      const total = await host.db.tag.count();
      await afterPage(page);
      return { rows, total };
    },
  };
  const registry = new ExportSourceRegistry();
  registry.register(source);
  const activity: ActivityLogPort = { record: async () => undefined };
  return new ExportCsv(registry, uow, activity, new FixedClock('2026-10-29T15:00:00.000Z'));
}

const namesOf = (content: string) => content.split(/\r?\n/).filter((l) => l.startsWith('t-'));

describe('ExportCsv over a real database', () => {
  it('does not duplicate a row when another row is inserted before the page boundary mid-export', async () => {
    const run = exporter(async (page) => {
      if (page === 1)
        await admin.tag.create({ data: { id: 'tag_new', name: 't-000', color: '#000' } });
    });

    const result = await run.execute(user, {
      entity: 'TAG',
      query: {} as never,
      columns: [{ id: 'name', label: 'Name' }],
    });

    const names = namesOf(result.content);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(TOTAL);
  });

  it('does not skip a row when another row is removed before the page boundary mid-export', async () => {
    const run = exporter(async (page) => {
      if (page === 1) await admin.tag.delete({ where: { id: 'tag_0' } });
    });

    const result = await run.execute(user, {
      entity: 'TAG',
      query: {} as never,
      columns: [{ id: 'name', label: 'Name' }],
    });

    const names = namesOf(result.content);
    expect(names).toHaveLength(TOTAL);
    expect(names).toContain(nameOf(EXPORT_PAGE_SIZE + 1));
  });
});
