import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { BillingRepository } from '../../ports/billing.repository.port';
import { BILLING_ERRORS, dateError, defaultUpTo, invalid } from './billing-support';
import type { BillingTransaction } from './billing-transaction';
import type { RecurringGenerator } from './recurring-generator';

export interface GenerateMissingPeriodsInput {
  readonly recurringChargeId: string;
  /** Last date to generate up to; defaults to today plus the lead days. */
  readonly upTo?: DateOnly | undefined;
}

export interface GenerateMissingPeriodsResult {
  readonly created: number;
  readonly periodStarts: readonly DateOnly[];
}

/**
 * `POST /recurring-charges/{id}/generate-missing-periods`: the periods skipped while a charge was paused are
 * created up to `upTo`. It is the only path that generates for a paused charge and it walks from the first
 * period, filling gaps. A finished charge is `CONFLICT`. The charge row is locked, so a concurrent run of the
 * daily step cannot create the same period twice.
 */
export class GenerateMissingPeriods {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly generator: RecurringGenerator,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: GenerateMissingPeriodsInput,
  ): Promise<GenerateMissingPeriodsResult> {
    assertCan(this.authorization, actor, 'create', 'billing');
    if (input.upTo !== undefined) {
      const key = dateError(input.upTo);
      if (key !== null) throw invalid('upTo', key);
    }
    const stored = await this.repository.findCharge(input.recurringChargeId);
    if (stored === null) throw new NotFoundError();

    return this.tx.run(
      actorOf(actor),
      stored.projectId,
      { RecurringCharge: [stored.id] },
      async (project) => {
        const charge = await this.repository.findCharge(input.recurringChargeId);
        if (charge === null || charge.projectId !== project.id) throw new NotFoundError();
        if (charge.status === 'FINALIZADO') {
          throw new ConflictError({ message: BILLING_ERRORS.chargeFinished });
        }
        const now = this.clock.now();
        const upTo = input.upTo ?? defaultUpTo(todayInCaracas(now), charge.leadDays);
        const periodStarts = await this.generator.generate(charge, upTo, now, {
          ignoreStatus: true,
        });
        return {
          value: { created: periodStarts.length, periodStarts },
          changed: periodStarts.length > 0,
          activity: [
            {
              action: 'CREATE',
              entityType: 'RECURRING_CHARGE',
              entityId: charge.id,
              entityLabel: charge.label,
              metadata: { projectId: project.id, created: periodStarts.length },
            },
          ],
        };
      },
    );
  }
}
