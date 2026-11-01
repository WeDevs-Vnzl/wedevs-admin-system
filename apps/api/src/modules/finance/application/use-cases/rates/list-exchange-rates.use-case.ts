import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import type { ListQuery } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import type {
  ExchangeRate,
  ExchangeRateRepository,
} from '../../ports/exchange-rate.repository.port';
import { addErrors, dateErrors, EXCHANGE_RATE_SORT_FIELDS, toRateFilter } from './rate-support';

/**
 * Settings → Tasas table (PRD §8.15): every stored rate, newest date first by default, by currency, source and
 * date range. `can(read, settings)` first (Owner and Admin).
 */
export class ListExchangeRates {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly rates: ExchangeRateRepository,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<ExchangeRate>> {
    assertCan(this.authorization, actor, 'read', 'settings');
    const fieldErrors: FieldErrors = {};
    for (const name of ['dateFrom', 'dateTo'] as const) {
      const value = query.filters[name];
      if (typeof value === 'string') addErrors(fieldErrors, name, dateErrors(value));
    }
    if (
      query.sort &&
      !(EXCHANGE_RATE_SORT_FIELDS as readonly string[]).includes(query.sort.field)
    ) {
      addErrors(fieldErrors, 'sort', ['validation.sort.invalid']);
    }
    if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });
    return this.rates.list(toRateFilter(query));
  }
}
