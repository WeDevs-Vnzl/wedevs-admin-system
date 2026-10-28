import { Inject, Injectable } from '@nestjs/common';
import type { CurrencyRepository } from '../application/ports/currency.repository.port';
import { CURRENCY_MESSAGES, type Currency } from '../domain/currency';
import { ConflictError } from '../../../shared/domain/domain-error';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';

/** `Currency` rows through the current transaction (or the base client outside a unit of work). */
@Injectable()
export class PrismaCurrencyRepository implements CurrencyRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async list(): Promise<Currency[]> {
    const rows = await this.host.db.currency.findMany();
    return rows.map(toCurrency);
  }

  async findByCode(code: string): Promise<Currency | null> {
    const row = await this.host.db.currency.findUnique({ where: { code } });
    return row ? toCurrency(row) : null;
  }

  async insert(currency: Currency): Promise<void> {
    try {
      await this.host.db.currency.create({
        data: {
          code: currency.code,
          name: currency.name,
          symbol: currency.symbol,
          decimals: currency.decimals,
          active: currency.active,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError({ fieldErrors: { code: [CURRENCY_MESSAGES.codeTaken] } });
      }
      throw error;
    }
  }

  async update(currency: Currency): Promise<void> {
    await this.host.db.currency.update({
      where: { code: currency.code },
      data: {
        name: currency.name,
        symbol: currency.symbol,
        decimals: currency.decimals,
        active: currency.active,
      },
    });
  }
}

function toCurrency(row: {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  active: boolean;
}): Currency {
  return {
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    active: row.active,
  };
}
