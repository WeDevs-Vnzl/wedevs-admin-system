import type { CurrentUser } from '../../../../../shared/application/current-user';
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { SelectedRate } from '../../../domain/rates';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import { addErrors, currencyCodeErrors, dateErrors } from './rate-support';
import type { FieldErrors } from '../../../../../shared/domain/domain-error';

export interface GetRateForInput {
  /** Date-only `YYYY-MM-DD`. */
  readonly date: string;
  readonly currency: string;
}

/**
 * `getRateFor` (PRD §9.2, DT-67): the rate to prefill for `currency` on `date`, with every usable rate of the
 * effective date as `options`; `null` when there is none (the user types it). Authorization is the route's
 * `@Authenticated()` declaration: rates are reference data (DT-71), so there is no `can()` action to check.
 */
export class GetRateFor {
  constructor(private readonly rates: ExchangeRatePort) {}

  async execute(_actor: CurrentUser, input: GetRateForInput): Promise<SelectedRate | null> {
    const fieldErrors: FieldErrors = {};
    addErrors(fieldErrors, 'date', dateErrors(input.date));
    addErrors(fieldErrors, 'currency', currencyCodeErrors(input.currency));
    if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });
    return this.rates.getRateFor(input.date, input.currency);
  }
}
