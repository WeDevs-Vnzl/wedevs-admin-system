import { selectRate, type SelectedRate } from '../domain/rates';
import type { ExchangeRatePort } from '../application/ports/exchange-rate.port';
import type { ExchangeRateRepository } from '../application/ports/exchange-rate.repository.port';

/**
 * `ExchangeRatePort` over the stored rates: the manual, BCV and "other" rows of `ExchangeRate` (PRD §9.2,
 * DT-67). It reads the rows of the effective date and lets `selectRate` choose among them. USD never touches
 * the repository.
 */
export class ManualRateSource implements ExchangeRatePort {
  constructor(private readonly rates: ExchangeRateRepository) {}

  async getRateFor(date: string, currency: string): Promise<SelectedRate | null> {
    const rows = currency === 'USD' ? [] : await this.rates.findEffective(currency, date);
    return selectRate(rows, date, currency);
  }
}
