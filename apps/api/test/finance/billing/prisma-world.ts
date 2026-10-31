import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import { PrismaFinanceLookups } from '../../../src/modules/commercial/infrastructure/prisma-finance-lookups';
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
import type { BillingRepository } from '../../../src/modules/finance/application/ports/billing.repository.port';
import { CommercialBillingProjectsAdapter } from '../../../src/modules/finance/infrastructure/billing-projects.adapter';
import { ManualRateSource } from '../../../src/modules/finance/infrastructure/manual-rate-source';
import { PrismaBillingRepository } from '../../../src/modules/finance/infrastructure/prisma-billing.repository';
import { PrismaExchangeRateRepository } from '../../../src/modules/finance/infrastructure/prisma-exchange-rate.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { ClockPort } from '../../../src/shared/application/ports/clock.port';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import type { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { buildWorld as buildReadModels } from '../read-models/world';

export { Gate, gated, interleave } from '../concurrency/world';
export { seedClient, seedProject } from '../read-models/world';

/** The business day of the integration tests: 2026-10-09 in Caracas. */
export const NOW = '2026-10-09T15:00:00.000Z';

export interface PrismaWorldHooks {
  /** Decorates the row locks, e.g. `{ lock: async () => undefined }` to observe the unlocked behavior. */
  locks?: (locks: RowLocksPort) => RowLocksPort;
  /** Decorates the billing repository, e.g. to pause a transaction at a `Gate`. */
  repository?: (repository: BillingRepository) => BillingRepository;
  clock?: ClockPort;
}

/** The billing use cases over the real adapters, sharing one `TransactionHost` per world. */
export function buildPrismaWorld(service: PrismaService, hooks: PrismaWorldHooks = {}) {
  const models = buildReadModels(service);
  const { host, uow, projector } = models;
  const locks = (hooks.locks ?? ((l) => l))(new PrismaRowLocks(host));
  const repository = (hooks.repository ?? ((r) => r))(new PrismaBillingRepository(host));
  const projects = new CommercialBillingProjectsAdapter(
    new FinanceLookups(new PrismaFinanceLookups(host)),
  );
  const activity = new PrismaActivityLog(host, models.metrics);
  const rates = new ManualRateSource(new PrismaExchangeRateRepository(host));
  const clock = hooks.clock ?? new FixedClock(NOW);
  const ids = new CuidGenerator();
  const authorization = new MatrixAuthorization();
  const currencies = {
    knownCodes: async (codes: readonly string[]) =>
      new Set(
        (
          await host.db.currency.findMany({
            where: { code: { in: [...codes] } },
            select: { code: true },
          })
        ).map((row) => row.code),
      ),
  };
  const tx = new BillingTransaction(uow, locks, projects, projector, activity);
  const generator = new RecurringGenerator(repository, ids);
  return {
    ...models,
    locks,
    repository,
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

export type PrismaWorld = ReturnType<typeof buildPrismaWorld>;

/** The activity entry references the actor, so the caller must exist as a user. */
export async function ownerOf(admin: PrismaClient): Promise<CurrentUser> {
  const row = await admin.user.create({
    data: {
      clerkId: 'user_owner_billing',
      email: 'owner-billing@example.test',
      name: 'Owner',
      role: 'OWNER',
    },
  });
  return {
    userId: row.id,
    clerkId: row.clerkId,
    role: 'OWNER',
    email: row.email,
    name: row.name,
  };
}
