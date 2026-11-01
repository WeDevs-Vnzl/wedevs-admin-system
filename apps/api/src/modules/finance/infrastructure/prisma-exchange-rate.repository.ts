import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { paginated, pageWindow, type Paginated } from '../../../shared/domain/pagination';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  ExchangeRate,
  ExchangeRateDraft,
  ExchangeRateFilter,
  ExchangeRateRepository,
  RateConflictMode,
  SaveRateResult,
} from '../application/ports/exchange-rate.repository.port';
import type { RateRow } from '../domain/rates';

/** `ExchangeRate` rows through the current transaction (or the base client outside a unit of work). */
@Injectable()
export class PrismaExchangeRateRepository implements ExchangeRateRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async list(filter: ExchangeRateFilter): Promise<Paginated<ExchangeRate>> {
    const where = {
      ...(filter.currency ? { currency: { in: [...filter.currency] } } : {}),
      ...(filter.source ? { source: { in: [...filter.source] } } : {}),
      ...(filter.dateFrom || filter.dateTo
        ? {
            date: {
              ...(filter.dateFrom ? { gte: dateOnlyToDbDate(filter.dateFrom) } : {}),
              ...(filter.dateTo ? { lte: dateOnlyToDbDate(filter.dateTo) } : {}),
            },
          }
        : {}),
    };
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    const [rows, total] = await Promise.all([
      this.host.db.exchangeRate.findMany({
        where,
        orderBy: [{ [filter.sort.field]: filter.sort.direction }, { id: 'asc' }],
        skip,
        take,
      }),
      this.host.db.exchangeRate.count({ where }),
    ]);
    return paginated(rows.map(toRate), total, filter);
  }

  async findEffective(currency: string, date: string): Promise<RateRow[]> {
    const latest = await this.host.db.exchangeRate.findFirst({
      where: { currency, date: { lte: dateOnlyToDbDate(date) } },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    if (!latest) return [];
    const rows = await this.host.db.exchangeRate.findMany({
      where: { currency, date: latest.date },
    });
    return rows.map((row) => {
      const rate = toRate(row);
      return {
        date: rate.date,
        currency: rate.currency,
        usdRate: rate.usdRate,
        source: rate.source,
        createdAt: rate.createdAt,
      };
    });
  }

  async save(draft: ExchangeRateDraft, onConflict: RateConflictMode): Promise<SaveRateResult> {
    // One statement on the unique key: two writers of the same key never see a gap between a read and the
    // insert, so the loser waits on the winner's row and updates it (or skips) instead of failing.
    const conflict =
      onConflict === 'overwrite'
        ? Prisma.sql`DO UPDATE SET "usdRate" = EXCLUDED."usdRate"`
        : Prisma.sql`DO NOTHING`;
    const rows = await this.host.db.$queryRaw<RawRate[]>(Prisma.sql`
      INSERT INTO "ExchangeRate" ("id", "date", "currency", "usdRate", "source", "createdAt", "createdById")
      VALUES (${draft.id}, ${dateOnlyToDbDate(draft.date)}, ${draft.currency},
        ${stringToDecimal(draft.usdRate)}, ${draft.source}::"RateSource", ${new Date(draft.createdAt)},
        ${draft.createdById})
      ON CONFLICT ("date", "currency", "source") ${conflict}
      RETURNING "id", "date", "currency", "usdRate", "source", "createdAt", "createdById",
        (xmax = 0) AS "inserted"`);
    const row = rows[0];
    if (!row) return { outcome: 'skipped', rate: null };
    return { outcome: row.inserted ? 'created' : 'updated', rate: toRate(row) };
  }
}

interface RawRate {
  id: string;
  date: Date;
  currency: string;
  usdRate: Prisma.Decimal;
  source: ExchangeRate['source'];
  createdAt: Date;
  createdById: string | null;
  inserted: boolean;
}

function toRate(row: {
  id: string;
  date: Date;
  currency: string;
  usdRate: Parameters<typeof decimalToString>[0];
  source: ExchangeRate['source'];
  createdAt: Date;
  createdById: string | null;
}): ExchangeRate {
  return {
    id: row.id,
    date: dbDateToDateOnly(row.date),
    currency: row.currency,
    usdRate: decimalToString(row.usdRate),
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
  };
}
