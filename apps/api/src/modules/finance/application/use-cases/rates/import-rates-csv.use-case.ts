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
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { RateSource } from '../../../../../shared/domain/enums';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRateRepository } from '../../ports/exchange-rate.repository.port';
import {
  dateErrors,
  isRateSource,
  MAX_IMPORT_ROWS,
  RATE_MESSAGES,
  rateCurrencyErrors,
  usdRateErrors,
} from './rate-support';

export interface ImportRateRow {
  readonly date: string;
  readonly currency: string;
  readonly usdRate: string;
  readonly source: RateSource;
}

export interface ImportRatesCsvInput {
  readonly rows: readonly ImportRateRow[];
  /** Replace the rate of an existing date + currency + source; otherwise the row is skipped. */
  readonly overwrite: boolean;
}

export interface ImportRatesCsvResult {
  created: number;
  updated: number;
  skipped: number;
  /** 1-based positions in `rows` that failed validation, with i18n message keys. */
  errors: { row: number; messages: string[] }[];
}

/**
 * CSV import (PRD §8.15); the client parses the file and sends the rows. Each row is a date + currency +
 * source key: new keys are created, existing ones skipped, or updated with `overwrite`. A row with a bad
 * value or a currency outside the catalog is reported by its position and the rest is imported. Rows are
 * written in file order, so a repeated key in the file behaves as if it were already stored.
 */
export class ImportRatesCsv {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly rates: ExchangeRateRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly currencies: CurrencyCatalogPort,
  ) {}

  async execute(actor: CurrentUser, input: ImportRatesCsvInput): Promise<ImportRatesCsvResult> {
    assertCan(this.authorization, actor, 'update', 'settings');
    if (input.rows.length === 0) {
      throw new ValidationFailedError({ fieldErrors: { rows: [RATE_MESSAGES.required] } });
    }
    if (input.rows.length > MAX_IMPORT_ROWS) {
      throw new ValidationFailedError({ fieldErrors: { rows: ['validation.tooLarge'] } });
    }

    return this.uow.run(async () => {
      const known = await this.currencies.knownCodes([
        ...new Set(input.rows.map((row) => row.currency)),
      ]);
      const result: ImportRatesCsvResult = { created: 0, updated: 0, skipped: 0, errors: [] };
      const createdAt = this.clock.now().toISOString();
      for (const [index, row] of input.rows.entries()) {
        const messages = [
          ...dateErrors(row.date),
          ...rateCurrencyErrors(row.currency),
          ...usdRateErrors(row.usdRate),
          ...(isRateSource(row.source) ? [] : [RATE_MESSAGES.required]),
        ];
        if (messages.length === 0 && !known.has(row.currency)) {
          messages.push(RATE_MESSAGES.unknownCurrency);
        }
        if (messages.length > 0) {
          result.errors.push({ row: index + 1, messages });
          continue;
        }
        const saved = await this.rates.save(
          { id: this.ids.next(), ...row, createdAt, createdById: actor.userId },
          input.overwrite ? 'overwrite' : 'skip',
        );
        result[saved.outcome] += 1;
      }
      if (result.created + result.updated > 0) {
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'SETTINGS_CHANGE',
          entityType: 'SETTING',
          entityId: 'rates-import',
          entityLabel: 'CSV',
          changes: { ratesImported: [null, String(result.created + result.updated)] },
        });
      }
      return result;
    });
  }
}
