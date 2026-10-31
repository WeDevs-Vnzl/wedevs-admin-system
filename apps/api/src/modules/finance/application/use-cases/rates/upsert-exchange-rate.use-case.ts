import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import type { RateSource } from '../../../../../shared/domain/enums';
import { rateDeviationExceeds, selectRate } from '../../../domain/rates';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type {
  ExchangeRate,
  ExchangeRateRepository,
} from '../../ports/exchange-rate.repository.port';
import {
  addErrors,
  dateErrors,
  isRateSource,
  RATE_MESSAGES,
  rateCurrencyErrors,
  usdRateErrors,
} from './rate-support';

export interface UpsertExchangeRateInput {
  readonly date: string;
  readonly currency: string;
  readonly usdRate: string;
  readonly source: RateSource;
}

export interface UpsertExchangeRateResult {
  readonly rate: ExchangeRate;
  /** True when the key was new; false when the same date, currency and source was updated. */
  readonly created: boolean;
  /** The rate differs more than 10 % from the latest rate on or before its date (PRD §15 warning). */
  readonly deviationExceeded: boolean;
}

/**
 * Saves the rate of a date, currency and source (unique together, DT-67): the same key updates the rate,
 * another source adds a row next to it. Snapshots already taken by transactions never change (C16, §9.2): this
 * use case writes `ExchangeRate` and one `SETTINGS_CHANGE` only. `can(update, settings)` → validate → one unit
 * of work that compares with the latest rate, writes atomically on the key and logs.
 */
export class UpsertExchangeRate {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly rates: ExchangeRateRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly currencies: CurrencyCatalogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: UpsertExchangeRateInput,
  ): Promise<UpsertExchangeRateResult> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fieldErrors: FieldErrors = {};
    addErrors(fieldErrors, 'date', dateErrors(input.date));
    addErrors(fieldErrors, 'currency', rateCurrencyErrors(input.currency));
    addErrors(fieldErrors, 'usdRate', usdRateErrors(input.usdRate));
    if (!isRateSource(input.source)) addErrors(fieldErrors, 'source', [RATE_MESSAGES.required]);
    if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });

    return this.uow.run(async () => {
      const known = await this.currencies.knownCodes([input.currency]);
      if (!known.has(input.currency)) {
        throw new ValidationFailedError({
          fieldErrors: { currency: [RATE_MESSAGES.unknownCurrency] },
        });
      }
      const latest = selectRate(
        await this.rates.findEffective(input.currency, input.date),
        input.date,
        input.currency,
      );
      const result = await this.rates.save(
        {
          id: this.ids.next(),
          date: input.date,
          currency: input.currency,
          usdRate: input.usdRate,
          source: input.source,
          createdAt: this.clock.now().toISOString(),
          createdById: actor.userId,
        },
        'overwrite',
      );
      if (result.outcome === 'skipped') throw new Error('an overwrite save cannot be skipped');
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: result.rate.id,
        entityLabel: `${input.currency} ${input.date}`,
        changes: { [`rate.${input.source}`]: [null, input.usdRate] },
      });
      return {
        rate: result.rate,
        created: result.outcome === 'created',
        deviationExceeded: latest ? rateDeviationExceeds(input.usdRate, latest.usdRate) : false,
      };
    });
  }
}
