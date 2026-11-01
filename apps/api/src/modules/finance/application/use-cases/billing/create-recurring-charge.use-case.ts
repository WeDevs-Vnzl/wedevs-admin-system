import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { FREQUENCY_VALUES } from '../../../../../shared/domain/enums';
import { roundMoney } from '../../../../../shared/domain/money';
import type { BillingRepository } from '../../ports/billing.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import {
  assertKnownCurrencies,
  BILLING_ERRORS,
  BILLING_MESSAGES,
  FieldCollector,
  invalid,
  loadPage,
  monthlyUsdOf,
  usdRateOn,
  validateSchedule,
  DEFAULT_RECURRING_LEAD_DAYS,
  type BillingPageView,
  type RecurringScheduleInput,
} from './billing-support';
import type { BillingTransaction } from './billing-transaction';

export interface CreateRecurringChargeInput extends Omit<RecurringScheduleInput, 'leadDays'> {
  readonly projectId: string;
  /** Defaults to 7 days. */
  readonly leadDays?: number | undefined;
}

/** Checks the frequency, shared by create and edit. */
export function validateRecurring(input: RecurringScheduleInput): void {
  const errors = new FieldCollector();
  if (!(FREQUENCY_VALUES as readonly unknown[]).includes(input.frequency)) {
    errors.add('frequency', BILLING_MESSAGES.required);
  }
  validateSchedule(input, errors);
  errors.throwIfAny();
}

/**
 * `POST /projects/{id}/recurring-charges` (PRD §8.4.3, HU-10). The USD snapshot (`usdRate`,
 * `monthlyAmountUsd`) is taken at the rate of the business day and never recomputed (Δ10, C16): a non-USD
 * charge without a rate on or before that day is refused with `billing.errors.rateMissing`.
 */
export class CreateRecurringCharge {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly rates: ExchangeRatePort,
    private readonly currencies: CurrencyCatalogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateRecurringChargeInput): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'create', 'billing');
    const schedule = { ...input, leadDays: input.leadDays ?? DEFAULT_RECURRING_LEAD_DAYS };
    validateRecurring(schedule);

    return this.tx.run(actorOf(actor), input.projectId, {}, async (project) => {
      await assertKnownCurrencies(this.currencies, [{ path: 'currency', code: input.currency }]);
      const now = this.clock.now();
      const usdRate = await usdRateOn(this.rates, todayInCaracas(now), input.currency);
      if (usdRate === null) throw invalid('currency', BILLING_ERRORS.rateMissing);
      const amount = roundMoney(input.amount);
      const id = this.ids.next();
      await this.repository.insertCharge(
        {
          id,
          projectId: project.id,
          label: input.label,
          amount,
          currency: input.currency,
          frequency: input.frequency,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          billingDay: input.billingDay,
          leadDays: schedule.leadDays,
          status: 'ACTIVO',
          lastGeneratedPeriodStart: null,
          resumedOn: null,
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
            action: 'CREATE',
            entityType: 'RECURRING_CHARGE',
            entityId: id,
            entityLabel: input.label,
            metadata: { projectId: project.id, frequency: input.frequency },
          },
        ],
      };
    });
  }
}
