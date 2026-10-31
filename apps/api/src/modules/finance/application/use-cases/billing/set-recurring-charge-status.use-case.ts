import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { RECURRING_STATUS_VALUES, type RecurringStatus } from '../../../../../shared/domain/enums';
import type { BillingRepository } from '../../ports/billing.repository.port';
import {
  BILLING_ERRORS,
  BILLING_MESSAGES,
  invalid,
  loadPage,
  type BillingPageView,
} from './billing-support';
import type { BillingTransaction } from './billing-transaction';

export interface SetRecurringChargeStatusInput {
  readonly id: string;
  readonly status: RecurringStatus;
}

/**
 * `POST /recurring-charges/{id}/status`. Pauses, resumes or finishes a charge; a finished charge is final
 * (`CONFLICT`). A resume stores the business day in `resumedOn` (Q-BE3-2): the daily step skips the periods
 * whose generation day fell before it, and only "generate missing periods" creates them. Asking for the
 * current status changes nothing.
 */
export class SetRecurringChargeStatus {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: SetRecurringChargeStatusInput,
  ): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'update', 'billing');
    if (!(RECURRING_STATUS_VALUES as readonly unknown[]).includes(input.status)) {
      throw invalid('status', BILLING_MESSAGES.required);
    }
    const stored = await this.repository.findCharge(input.id);
    if (stored === null) throw new NotFoundError();

    return this.tx.run(
      actorOf(actor),
      stored.projectId,
      { RecurringCharge: [stored.id] },
      async (project) => {
        const charge = await this.repository.findCharge(input.id);
        if (charge === null || charge.projectId !== project.id) throw new NotFoundError();
        if (charge.status === input.status) {
          return {
            value: await loadPage(this.repository, project.id),
            changed: false,
            activity: [],
          };
        }
        if (charge.status === 'FINALIZADO') {
          throw new ConflictError({ message: BILLING_ERRORS.chargeFinished });
        }
        const now = this.clock.now();
        const resumed = charge.status === 'PAUSADO' && input.status === 'ACTIVO';
        await this.repository.updateCharge(
          charge.id,
          { status: input.status, ...(resumed ? { resumedOn: todayInCaracas(now) } : {}) },
          now,
        );
        return {
          value: await loadPage(this.repository, project.id),
          changed: true,
          activity: [
            {
              action: 'STATUS_CHANGE',
              entityType: 'RECURRING_CHARGE',
              entityId: charge.id,
              entityLabel: charge.label,
              changes: { status: [charge.status, input.status] },
              metadata: { projectId: project.id },
            },
          ],
        };
      },
    );
  }
}
