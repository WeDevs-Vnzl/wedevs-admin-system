import { RecomputeAll, SYSTEM_ACTOR } from '../src/modules/finance/application/recompute-all';
import type { RecomputeAllResult } from '../src/modules/finance/application/recompute-all';
import { FinanceProjector } from '../src/modules/finance/application/finance-projector';
import { PrismaFinanceSources } from '../src/modules/finance/infrastructure/prisma-finance-sources';
import { PrismaReadModelWriter } from '../src/modules/finance/infrastructure/prisma-read-model-writer';
import { PrismaActivityLog } from '../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from '../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaUnitOfWork } from '../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../src/shared/infrastructure/system-clock.adapter';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Local database only (safeguards): the URL is never printed. */
function assertLocalDatabase(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (['host', 'hostaddr', 'service'].some((key) => parsed.searchParams.has(key))) {
    throw new Error('Refusing to run against a database URL with a host override');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('Refusing to run against a non-local database host');
  }
  return url;
}

/**
 * Rebuilds every finance cache and read model through `RecomputeAll` as the `SYSTEM` actor. No route:
 * wired by hand over the same adapters the app uses (data-rules §8). Local database only.
 */
export async function runRecomputeAll(
  databaseUrl: string | undefined,
): Promise<RecomputeAllResult> {
  const service = new PrismaService({ DATABASE_URL: assertLocalDatabase(databaseUrl) });
  try {
    const host = new TransactionHost(service);
    const clock = new SystemClock();
    const sources = new PrismaFinanceSources(host);
    const writer = new PrismaReadModelWriter(host);
    const useCase = new RecomputeAll(
      new PrismaUnitOfWork(host),
      new PrismaRowLocks(host),
      sources,
      writer,
      new FinanceProjector(sources, writer, clock),
      new PrismaActivityLog(host, new PrismaClientMetricsWriter(host)),
      clock,
    );
    return await useCase.execute(SYSTEM_ACTOR);
  } finally {
    await service.client.$disconnect();
  }
}

if (require.main === module) {
  runRecomputeAll(process.env.DATABASE_URL).then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
