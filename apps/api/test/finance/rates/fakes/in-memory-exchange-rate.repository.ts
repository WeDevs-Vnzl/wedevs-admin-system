import type {
  ExchangeRate,
  ExchangeRateDraft,
  ExchangeRateFilter,
  ExchangeRateRepository,
  RateConflictMode,
  SaveRateResult,
} from '../../../../src/modules/finance/application/ports/exchange-rate.repository.port';
import type { RateRow } from '../../../../src/modules/finance/domain/rates';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

const keyOf = (row: { date: string; currency: string; source: string }): string =>
  `${row.date}|${row.currency}|${row.source}`;

/** Fake `ExchangeRateRepository`: one row per key, rolled back with the unit of work like the database. */
export class InMemoryExchangeRateRepository
  implements ExchangeRateRepository, TransactionParticipant
{
  private rows = new Map<string, ExchangeRate>();
  private snapshot: Map<string, ExchangeRate> | null = null;
  /** Currency catalog: only these codes are accepted by `knownCurrencies`. */
  readonly currencies = new Set<string>(['USD', 'VES', 'EUR']);

  constructor(uow?: InMemoryUnitOfWork) {
    uow?.enlist(this);
  }

  get all(): readonly ExchangeRate[] {
    return [...this.rows.values()];
  }

  seed(rate: ExchangeRate): void {
    this.rows.set(keyOf(rate), rate);
  }

  async list(filter: ExchangeRateFilter): Promise<Paginated<ExchangeRate>> {
    const matching = this.all
      .filter((row) => !filter.currency || filter.currency.includes(row.currency))
      .filter((row) => !filter.source || filter.source.includes(row.source))
      .filter((row) => !filter.dateFrom || row.date >= filter.dateFrom)
      .filter((row) => !filter.dateTo || row.date <= filter.dateTo);
    const field = filter.sort.field as keyof ExchangeRate;
    const sign = filter.sort.direction === 'asc' ? 1 : -1;
    const value = (row: ExchangeRate): string | number =>
      field === 'usdRate' ? Number(row.usdRate) : String(row[field]);
    matching.sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      return (x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)) * sign;
    });
    const start = (filter.page - 1) * filter.pageSize;
    return paginated(matching.slice(start, start + filter.pageSize), matching.length, filter);
  }

  async findEffective(currency: string, date: string): Promise<RateRow[]> {
    const ofCurrency = this.all.filter((row) => row.currency === currency && row.date <= date);
    const latest = ofCurrency
      .map((row) => row.date)
      .sort()
      .at(-1);
    return ofCurrency
      .filter((row) => row.date === latest)
      .map(({ date: d, currency: c, usdRate, source, createdAt }) => ({
        date: d,
        currency: c,
        usdRate,
        source,
        createdAt,
      }));
  }

  async knownCurrencies(codes: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set(codes.filter((code) => this.currencies.has(code)));
  }

  async save(draft: ExchangeRateDraft, onConflict: RateConflictMode): Promise<SaveRateResult> {
    const existing = this.rows.get(keyOf(draft));
    if (existing) {
      if (onConflict === 'skip') return { outcome: 'skipped', rate: null };
      const rate = { ...existing, usdRate: draft.usdRate };
      this.rows.set(keyOf(draft), rate);
      return { outcome: 'updated', rate };
    }
    const rate: ExchangeRate = { ...draft };
    this.rows.set(keyOf(draft), rate);
    return { outcome: 'created', rate };
  }

  begin(): void {
    this.snapshot = new Map(this.rows);
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) this.rows = this.snapshot;
    this.snapshot = null;
  }
}
