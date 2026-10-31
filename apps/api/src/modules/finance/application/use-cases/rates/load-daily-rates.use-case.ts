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
import type { ExchangeRateRepository } from '../../ports/exchange-rate.repository.port';
import {
  addErrors,
  dateErrors,
  isRateSource,
  MAX_DAILY_RATES,
  RATE_MESSAGES,
  rateCurrencyErrors,
  usdRateErrors,
} from './rate-support';

export interface LoadDailyRatesInput {
  readonly date: string;
  readonly source: RateSource;
  readonly rates: readonly { readonly currency: string; readonly usdRate: string }[];
}

/**
 * Quick daily load (PRD §8.15): several currencies for one date and source, all or nothing. Every row is
 * checked before the first write; the writes follow currency order so two overlapping loads take the unique
 * keys in the same order and cannot deadlock.
 */
export class LoadDailyRates {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly rates: ExchangeRateRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: LoadDailyRatesInput,
  ): Promise<{ created: number; updated: number }> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fieldErrors: FieldErrors = {};
    addErrors(fieldErrors, 'date', dateErrors(input.date));
    if (!isRateSource(input.source)) addErrors(fieldErrors, 'source', [RATE_MESSAGES.required]);
    if (input.rates.length === 0) addErrors(fieldErrors, 'rates', [RATE_MESSAGES.required]);
    if (input.rates.length > MAX_DAILY_RATES)
      addErrors(fieldErrors, 'rates', ['validation.tooLarge']);
    const seen = new Set<string>();
    input.rates.forEach((row, index) => {
      addErrors(fieldErrors, `rates.${index}.currency`, rateCurrencyErrors(row.currency));
      addErrors(fieldErrors, `rates.${index}.usdRate`, usdRateErrors(row.usdRate));
      if (seen.has(row.currency)) {
        addErrors(fieldErrors, `rates.${index}.currency`, [RATE_MESSAGES.duplicateCurrency]);
      }
      seen.add(row.currency);
    });
    if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });

    return this.uow.run(async () => {
      const known = await this.rates.knownCurrencies(input.rates.map((row) => row.currency));
      input.rates.forEach((row, index) => {
        if (!known.has(row.currency)) {
          addErrors(fieldErrors, `rates.${index}.currency`, [RATE_MESSAGES.unknownCurrency]);
        }
      });
      if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });

      const createdAt = this.clock.now().toISOString();
      const ordered = [...input.rates].sort((a, b) => (a.currency < b.currency ? -1 : 1));
      let created = 0;
      for (const row of ordered) {
        const result = await this.rates.save(
          {
            id: this.ids.next(),
            date: input.date,
            currency: row.currency,
            usdRate: row.usdRate,
            source: input.source,
            createdAt,
            createdById: actor.userId,
          },
          'overwrite',
        );
        if (result.outcome === 'created') created += 1;
      }
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: `rates-${input.date}`,
        entityLabel: input.date,
        changes: {
          [`rates.${input.source}`]: [null, ordered.map((row) => row.currency).join(', ')],
        },
      });
      return { created, updated: ordered.length - created };
    });
  }
}
