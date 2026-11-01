import { GetRateFor } from '../../../src/modules/finance/application/use-cases/rates/get-rate-for.use-case';
import { ImportRatesCsv } from '../../../src/modules/finance/application/use-cases/rates/import-rates-csv.use-case';
import { ListExchangeRates } from '../../../src/modules/finance/application/use-cases/rates/list-exchange-rates.use-case';
import { LoadDailyRates } from '../../../src/modules/finance/application/use-cases/rates/load-daily-rates.use-case';
import { UpsertExchangeRate } from '../../../src/modules/finance/application/use-cases/rates/upsert-exchange-rate.use-case';
import type { ExchangeRate } from '../../../src/modules/finance/application/ports/exchange-rate.repository.port';
import { ManualRateSource } from '../../../src/modules/finance/infrastructure/manual-rate-source';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryExchangeRateRepository } from './fakes/in-memory-exchange-rate.repository';

export const NOW = '2026-10-12T15:00:00.000Z';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

export const rate = (
  date: string,
  currency: string,
  usdRate: string,
  source: ExchangeRate['source'] = 'MANUAL',
  createdAt = '2026-10-01T10:00:00.000Z',
): ExchangeRate => ({
  id: `seed_${date}_${currency}_${source}`,
  date,
  currency,
  usdRate,
  source,
  createdAt,
  createdById: null,
});

export async function rejection(promise: Promise<unknown>): Promise<{
  code?: string;
  fieldErrors?: Record<string, string[]>;
}> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error('expected the promise to reject');
}

/** The rates use cases over in-memory ports and the real permission matrix. */
export function createWorld() {
  const uow = new InMemoryUnitOfWork();
  const repository = new InMemoryExchangeRateRepository(uow);
  const activity = new InMemoryActivityLog(uow);
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator('rte');
  const authorization = new MatrixAuthorization();
  const source = new ManualRateSource(repository);
  const catalog = new Set(['USD', 'VES', 'EUR']);
  const currencies = {
    knownCodes: async (codes: readonly string[]) =>
      new Set(codes.filter((code) => catalog.has(code))),
  };
  return {
    uow,
    repository,
    activity,
    clock,
    source,
    owner: userOf('OWNER'),
    admin: userOf('ADMIN'),
    member: userOf('MEMBER'),
    viewer: userOf('VIEWER'),
    getRateFor: new GetRateFor(source),
    listRates: new ListExchangeRates(authorization, repository),
    upsert: new UpsertExchangeRate(
      authorization,
      uow,
      repository,
      activity,
      clock,
      ids,
      currencies,
    ),
    loadDaily: new LoadDailyRates(authorization, uow, repository, activity, clock, ids, currencies),
    importCsv: new ImportRatesCsv(authorization, uow, repository, activity, clock, ids, currencies),
  };
}
