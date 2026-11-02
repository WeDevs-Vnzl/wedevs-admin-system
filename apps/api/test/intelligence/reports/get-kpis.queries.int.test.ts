import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { GetKpis } from '../../../src/modules/intelligence/application/use-cases/reports/get-kpis.use-case';
import { PrismaFinanceFactsRead } from '../../../src/modules/intelligence/infrastructure/prisma-finance-facts-read';
import { PrismaReportInputsRead } from '../../../src/modules/intelligence/infrastructure/prisma-report-inputs-read';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import {
  TransactionHost,
  type DbClient,
} from '../../../src/shared/infrastructure/prisma/transaction-host';
import { buildWorld } from '../../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { FakeRates, NOW, userOf } from './reports-world';
import { seedReportsStudio } from './seed';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const world = buildWorld(service);

/** A host whose client counts the raw statements it runs. */
class CountingHost extends TransactionHost {
  statements = 0;
  override get db(): DbClient {
    const real = super.db;
    return new Proxy(real, {
      get: (target, property) => {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== 'function') return value;
        const isRaw = property === '$queryRaw' || property === '$queryRawUnsafe';
        return (...args: unknown[]) => {
          if (isRaw) this.statements += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  }
}

beforeAll(async () => {
  await truncateBusinessTables(admin);
  await admin.expenseCategory.deleteMany({ where: { id: 'cat-child' } });
  await seedReportsStudio(world, admin);
}, 120_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await admin.expenseCategory.deleteMany({ where: { id: 'cat-child' } });
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('GetKpis over the Prisma adapters', () => {
  it('runs a constant number of statements for the 18 cards and their 12-month sparklines', async () => {
    const host = new CountingHost(service);
    const rates = new FakeRates();
    rates.byCurrency.set('VES', '36');
    const getKpis = new GetKpis(
      new MatrixAuthorization(),
      new PrismaFinanceFactsRead(host),
      new PrismaReportInputsRead(host),
      rates,
      new FixedClock(NOW),
    );

    const result = await getKpis.execute(userOf('OWNER'), { preset: 'LAST_12_MONTHS' });
    expect(result.kpis).toHaveLength(18);
    const wide = host.statements;

    host.statements = 0;
    await getKpis.execute(userOf('OWNER'), {
      preset: 'CUSTOM',
      from: '2026-10-01',
      to: '2026-10-09',
      clientId: 'cli_a',
      tagId: 'tag_a',
    });

    // Facts: the range, the period before, the 14-month series, the 3 months before the previous close.
    // Inputs: receivable (all closes at once), collections, project flows, charges, recurring expenses,
    // balances, projects and their documents, clients; at most one label read per breakdown kind.
    // Filter ids add one existence check each. None of it grows with the cards or the months.
    expect(wide).toBeLessThanOrEqual(4 + 9 + 3);
    expect(host.statements).toBeLessThanOrEqual(4 + 9 + 3 + 2);
    expect(host.statements).toBeGreaterThanOrEqual(13);
  });
});
