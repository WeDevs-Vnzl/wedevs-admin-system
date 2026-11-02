import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { ExchangeRatePort } from '../../../src/modules/finance/application/ports/exchange-rate.port';
import { GetKpis } from '../../../src/modules/intelligence/application/use-cases/reports/get-kpis.use-case';
import { GetReport } from '../../../src/modules/intelligence/application/use-cases/reports/get-report.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { InMemoryFinanceFactsRead } from '../../support/fakes/in-memory-finance-facts-read';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryReportInputsRead } from './fakes/in-memory-report-inputs-read';

/** 2026-10-09, 12:00 in Caracas. */
export const NOW = '2026-10-09T16:00:00.000Z';
export const TODAY = '2026-10-09';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `clerk_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

/** Rates by currency; USD is always 1 (the real source answers the same). */
export class FakeRates implements ExchangeRatePort {
  readonly byCurrency = new Map<string, string>();
  async getRateFor(date: string, currency: string) {
    const usdRate = currency === 'USD' ? '1' : this.byCurrency.get(currency);
    return usdRate === undefined
      ? null
      : { usdRate, source: null, isFallback: false, effectiveDate: date, options: [] };
  }
}

export function buildReportsWorld(now: string = NOW) {
  const facts = new InMemoryFinanceFactsRead();
  const inputs = new InMemoryReportInputsRead();
  const rates = new FakeRates();
  const clock = new FixedClock(now);
  const authorization = new MatrixAuthorization();
  for (const [kind, ids] of [
    ['CLIENT', ['cli_a', 'cli_b']],
    ['PROJECT', ['pry_a', 'pry_b']],
    ['TAG', ['tag_a']],
  ] as const) {
    for (const id of ids) inputs.existing[kind].add(id);
  }
  return {
    facts,
    inputs,
    rates,
    clock,
    getReport: new GetReport(authorization, facts, inputs, clock),
    getKpis: new GetKpis(authorization, facts, inputs, rates, clock),
  };
}
