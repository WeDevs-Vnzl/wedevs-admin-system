import type { Actor } from '../../../../../shared/application/actor';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { BillingRepository } from '../../ports/billing.repository.port';
import type { BillingTransaction } from './billing-transaction';
import type { GenerateMissingPeriodsResult } from './generate-missing-periods.use-case';
import type { RecurringGenerator } from './recurring-generator';

/**
 * Step of `daily-maintenance` (PRD §12, HU-10): generates every due period of every active recurring charge
 * as of the business day. Running it twice on the same day creates nothing the second time. No route: BE-5
 * schedules it under `SYSTEM_ACTOR` and the caller must be a `SYSTEM` actor (a user goes through
 * `GenerateMissingPeriods`).
 *
 * Each charge has its own unit of work that locks the project, its clients and the charge row first, so two
 * concurrent runs queue on the charge, the second one finds the periods and creates none. A charge whose
 * project was archived meanwhile is skipped.
 */
export class GenerateRecurringInstallments {
  constructor(
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly generator: RecurringGenerator,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: Actor): Promise<GenerateMissingPeriodsResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const periodStarts: DateOnly[] = [];
    for (const id of await this.repository.activeChargeIds()) {
      const created = await this.generateFor(actor, id);
      periodStarts.push(...created);
    }
    return { created: periodStarts.length, periodStarts };
  }

  private async generateFor(actor: Actor, chargeId: string): Promise<readonly DateOnly[]> {
    const stored = await this.repository.findCharge(chargeId);
    if (stored === null) return [];
    try {
      return await this.tx.run(
        actor,
        stored.projectId,
        { RecurringCharge: [chargeId] },
        async (project) => {
          const charge = await this.repository.findCharge(chargeId);
          if (charge === null || charge.status !== 'ACTIVO') {
            return { value: [], changed: false, activity: [] };
          }
          const now = this.clock.now();
          const created = await this.generator.generate(charge, todayInCaracas(now), now);
          return {
            value: created,
            changed: created.length > 0,
            activity: [
              {
                action: 'SYSTEM_JOB',
                entityType: 'RECURRING_CHARGE',
                entityId: charge.id,
                entityLabel: charge.label,
                metadata: { projectId: project.id, created: created.length },
              },
            ],
          };
        },
      );
    } catch (error) {
      if (error instanceof NotFoundError) return [];
      throw error;
    }
  }
}
