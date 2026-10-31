import { ApplyInstallmentTemplate } from '../../../src/modules/finance/application/use-cases/billing/apply-installment-template.use-case';
import { BillingTransaction } from '../../../src/modules/finance/application/use-cases/billing/billing-transaction';
import { CancelInstallment } from '../../../src/modules/finance/application/use-cases/billing/cancel-installment.use-case';
import { CreateInstallment } from '../../../src/modules/finance/application/use-cases/billing/create-installment.use-case';
import { CreateRecurringCharge } from '../../../src/modules/finance/application/use-cases/billing/create-recurring-charge.use-case';
import { GenerateMissingPeriods } from '../../../src/modules/finance/application/use-cases/billing/generate-missing-periods.use-case';
import { GenerateRecurringInstallments } from '../../../src/modules/finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { GetBillingPage } from '../../../src/modules/finance/application/use-cases/billing/get-billing-page.use-case';
import { ProjectBillingApi } from '../../../src/modules/finance/application/use-cases/billing/project-billing.api';
import { RecomputeInstallmentStatus } from '../../../src/modules/finance/application/use-cases/billing/recompute-installment-status';
import { RecurringGenerator } from '../../../src/modules/finance/application/use-cases/billing/recurring-generator';
import { SetRecurringChargeStatus } from '../../../src/modules/finance/application/use-cases/billing/set-recurring-charge-status.use-case';
import { UpdateInstallment } from '../../../src/modules/finance/application/use-cases/billing/update-installment.use-case';
import { UpdateRecurringCharge } from '../../../src/modules/finance/application/use-cases/billing/update-recurring-charge.use-case';
import { UpsertBillingPlan } from '../../../src/modules/finance/application/use-cases/billing/upsert-billing-plan.use-case';
import type {
  BillingProject,
  BillingProjectsPort,
} from '../../../src/modules/finance/application/ports/billing-projects.port';
import type { ExchangeRate } from '../../../src/modules/finance/application/ports/exchange-rate.repository.port';
import { ManualRateSource } from '../../../src/modules/finance/infrastructure/manual-rate-source';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryExchangeRateRepository } from '../rates/fakes/in-memory-exchange-rate.repository';
import { InMemoryBillingRepository } from './fakes/in-memory-billing.repository';

/** The business day of the unit tests: 2026-10-09 in Caracas. */
export const NOW = '2026-10-09T15:00:00.000Z';
export const PROJECT = 'pry_solaris';
export const CLIENT = 'cli_a';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export async function rejection(promise: Promise<unknown>): Promise<{
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error('expected the promise to reject');
}

export const rateRow = (
  date: string,
  currency: string,
  usdRate: string,
  source: ExchangeRate['source'] = 'BCV',
): ExchangeRate => ({
  id: `rate_${date}_${currency}_${source}`,
  date,
  currency,
  usdRate,
  source,
  createdAt: '2026-10-01T10:00:00.000Z',
  createdById: null,
});

/** Records the projections a mutation asked for, in order. */
export class RecordingProjector {
  readonly calls: { method: 'projectClients' | 'projectProjects'; ids: readonly string[] }[] = [];

  async projectClients(ids: readonly string[]): Promise<void> {
    this.calls.push({ method: 'projectClients', ids });
  }

  async projectProjects(ids: readonly string[]): Promise<void> {
    this.calls.push({ method: 'projectProjects', ids });
  }
}

class FakeProjects implements BillingProjectsPort {
  readonly live = new Map<string, BillingProject>([
    [PROJECT, { id: PROJECT, code: 'PRY-0001', name: 'Solaris', clientIds: [CLIENT] }],
  ]);

  async liveProject(id: string): Promise<BillingProject | null> {
    return this.live.get(id) ?? null;
  }
}

/** The billing use cases over in-memory ports and the real permission matrix. */
export function createWorld() {
  const uow = new InMemoryUnitOfWork();
  const locks = new InMemoryRowLocks(uow);
  const activity = new InMemoryActivityLog(uow);
  const repository = new InMemoryBillingRepository(uow);
  const rateRepository = new InMemoryExchangeRateRepository(uow);
  const rates = new ManualRateSource(rateRepository);
  const projects = new FakeProjects();
  const projector = new RecordingProjector();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator('bil');
  const authorization = new MatrixAuthorization();
  const catalog = new Set(['USD', 'VES', 'EUR']);
  const currencies = {
    knownCodes: async (codes: readonly string[]) => new Set(codes.filter((c) => catalog.has(c))),
  };
  const tx = new BillingTransaction(uow, locks, projects, projector, activity);
  const generator = new RecurringGenerator(repository, ids);
  return {
    uow,
    locks,
    activity,
    repository,
    rateRepository,
    projects,
    projector,
    clock,
    owner: userOf('OWNER'),
    admin: userOf('ADMIN'),
    member: userOf('MEMBER'),
    viewer: userOf('VIEWER'),
    getPage: new GetBillingPage(authorization, uow, projects, repository),
    upsertPlan: new UpsertBillingPlan(authorization, tx, repository, rates, currencies, clock, ids),
    applyTemplate: new ApplyInstallmentTemplate(
      authorization,
      tx,
      repository,
      currencies,
      clock,
      ids,
    ),
    createInstallment: new CreateInstallment(authorization, tx, repository, currencies, ids),
    updateInstallment: new UpdateInstallment(authorization, tx, repository, currencies, clock),
    cancelInstallment: new CancelInstallment(authorization, tx, repository, clock),
    createCharge: new CreateRecurringCharge(
      authorization,
      tx,
      repository,
      rates,
      currencies,
      clock,
      ids,
    ),
    updateCharge: new UpdateRecurringCharge(
      authorization,
      tx,
      repository,
      rates,
      currencies,
      clock,
    ),
    setChargeStatus: new SetRecurringChargeStatus(authorization, tx, repository, clock),
    generateMissing: new GenerateMissingPeriods(authorization, tx, repository, generator, clock),
    runGeneration: new GenerateRecurringInstallments(tx, repository, generator, clock),
    recomputeStatus: new RecomputeInstallmentStatus(uow, repository),
    projectApi: new ProjectBillingApi(uow, repository, projects, projector, clock),
  };
}

export type World = ReturnType<typeof createWorld>;
