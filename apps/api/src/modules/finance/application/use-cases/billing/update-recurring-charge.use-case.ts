import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { compareMoney, roundMoney } from '../../../../../shared/domain/money';
import type { BillingRepository } from '../../ports/billing.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import {
  assertKnownCurrencies,
  BILLING_ERRORS,
  invalid,
  loadPage,
  monthlyUsdOf,
  usdRateOn,
  type BillingPageView,
  type RecurringScheduleInput,
} from './billing-support';
import type { BillingTransaction } from './billing-transaction';
import { validateRecurring } from './create-recurring-charge.use-case';

export interface UpdateRecurringChargeInput extends RecurringScheduleInput {
  readonly id: string;
}

/**
 * `PATCH /recurring-charges/{id}`. Changing the amount affects only the periods not generated yet:
 * generated installments are untouched. The USD snapshot is retaken at the rate of the business day when the
 * amount or the currency changes (Δ10); a frequency change keeps the rate and recomputes the monthly USD.
 * A finished charge is final (`CONFLICT`). The charge row is locked before it is read.
 */
export class UpdateRecurringCharge {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly rates: ExchangeRatePort,
    private readonly currencies: CurrencyCatalogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: UpdateRecurringChargeInput): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'update', 'billing');
    validateRecurring(input);
    const stored = await this.repository.findCharge(input.id);
    if (stored === null) throw new NotFoundError();

    return this.tx.run(
      actorOf(actor),
      stored.projectId,
      { RecurringCharge: [stored.id] },
      async (project) => {
        const charge = await this.repository.findCharge(input.id);
        if (charge === null || charge.projectId !== project.id) throw new NotFoundError();
        if (charge.status === 'FINALIZADO') {
          throw new ConflictError({ message: BILLING_ERRORS.chargeFinished });
        }
        await assertKnownCurrencies(this.currencies, [{ path: 'currency', code: input.currency }]);
        const now = this.clock.now();
        const amount = roundMoney(input.amount);
        const retake =
          charge.currency !== input.currency || compareMoney(charge.amount, amount) !== 0;
        let usdRate = charge.usdRate;
        if (retake) {
          const rate = await usdRateOn(this.rates, todayInCaracas(now), input.currency);
          if (rate === null) throw invalid('currency', BILLING_ERRORS.rateMissing);
          usdRate = rate;
        }
        await this.repository.updateCharge(
          charge.id,
          {
            label: input.label,
            amount,
            currency: input.currency,
            frequency: input.frequency,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            billingDay: input.billingDay,
            leadDays: input.leadDays,
            usdRate,
            monthlyAmountUsd: monthlyUsdOf(amount, input.frequency, usdRate),
          },
          now,
        );
        return {
          value: await loadPage(this.repository, project.id),
          changed: true,
          activity: [
            {
              action: 'UPDATE',
              entityType: 'RECURRING_CHARGE',
              entityId: charge.id,
              entityLabel: input.label,
              metadata: { projectId: project.id },
            },
          ],
        };
      },
    );
  }
}
