import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RATE_SOURCE_VALUES } from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  rateSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import {
  DEFAULT_RATE_SORT,
  EXCHANGE_RATE_SORT_FIELDS,
  MAX_DAILY_RATES,
  MAX_IMPORT_ROWS,
  RATE_MESSAGES,
} from '../../../application/use-cases/rates/rate-support';
import type { UpsertExchangeRateResult } from '../../../application/use-cases/rates/upsert-exchange-rate.use-case';
import type { ImportRatesCsvResult } from '../../../application/use-cases/rates/import-rates-csv.use-case';
import type { ExchangeRate } from '../../../application/ports/exchange-rate.repository.port';
import type { GetRateFor } from '../../../application/use-cases/rates/get-rate-for.use-case';

/**
 * Request and response shapes of the exchange rate routes (the FE `catalogs` validators). Rates travel as
 * decimal strings with at most 8 decimals; the use cases repeat the checks for callers that skip the DTO.
 */

const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{2,9}$/, { message: RATE_MESSAGES.invalidCurrency });

/** A rate is "units of the currency per 1 USD", so USD itself never has a row. */
const rateCurrencySchema = currencyCodeSchema.refine((code) => code !== 'USD', {
  message: RATE_MESSAGES.currencyIsUsd,
});
const rateSourceSchema = z.enum(RATE_SOURCE_VALUES);

/** `GET /exchange-rates`: paging, `sort` and the facets of the Settings table. */
export class ListExchangeRatesQueryDto extends createListQueryDto({
  sortFields: EXCHANGE_RATE_SORT_FIELDS,
  defaultSort: DEFAULT_RATE_SORT,
  filters: {
    currency: currencyCodeSchema,
    source: rateSourceSchema,
    dateFrom: dateOnlySchema,
    dateTo: dateOnlySchema,
  },
}) {}

/** `GET /exchange-rates/lookup?date&currency` (`getRateFor`). */
export const rateLookupQuerySchema = z.object({
  date: dateOnlySchema,
  currency: currencyCodeSchema,
});
export class RateLookupQueryDto extends createZodDto(rateLookupQuerySchema) {}

/** `POST /exchange-rates`: unique per date + currency + source, so the same key updates the rate. */
export const upsertExchangeRateSchema = z.object({
  date: dateOnlySchema,
  currency: rateCurrencySchema,
  usdRate: rateSchema,
  source: rateSourceSchema.default('MANUAL'),
});
export class UpsertExchangeRateDto extends createZodDto(upsertExchangeRateSchema) {}

/** `POST /exchange-rates/daily`: several currencies for one date and one source, all or nothing. */
export const loadDailyRatesSchema = z
  .object({
    date: dateOnlySchema,
    source: rateSourceSchema.default('MANUAL'),
    rates: z
      .array(z.object({ currency: rateCurrencySchema, usdRate: rateSchema }))
      .min(1, RATE_MESSAGES.required)
      .max(MAX_DAILY_RATES),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.rates.forEach((row, index) => {
      if (seen.has(row.currency)) {
        ctx.addIssue({
          code: 'custom',
          message: RATE_MESSAGES.duplicateCurrency,
          path: ['rates', index, 'currency'],
        });
      }
      seen.add(row.currency);
    });
  });
export class LoadDailyRatesDto extends createZodDto(loadDailyRatesSchema) {}

/** `POST /exchange-rates/import`: the FE parses the CSV and sends the rows (a blank source is `MANUAL`). */
export const importRatesSchema = z.object({
  rows: z
    .array(
      z.object({
        date: dateOnlySchema,
        currency: rateCurrencySchema,
        usdRate: rateSchema,
        source: rateSourceSchema.default('MANUAL'),
      }),
    )
    .min(1, RATE_MESSAGES.required)
    .max(MAX_IMPORT_ROWS),
  /** Replace the rate of an existing date + currency + source; otherwise the row is skipped. */
  overwrite: z.boolean().default(false),
});
export class ImportRatesDto extends createZodDto(importRatesSchema) {}

export const exchangeRateResponseSchema = z.object({
  id: idSchema,
  date: dateOnlySchema,
  currency: z.string(),
  usdRate: decimalStringSchema,
  source: rateSourceSchema,
  createdAt: timestampSchema,
  createdById: z.string().nullable(),
});
export class ExchangeRateResponseDto extends createZodDto(exchangeRateResponseSchema) {}

export const exchangeRateListResponseSchema = z.object({
  items: z.array(exchangeRateResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class ExchangeRateListResponseDto extends createZodDto(exchangeRateListResponseSchema) {}

export const upsertExchangeRateResponseSchema = z.object({
  rate: exchangeRateResponseSchema,
  created: z.boolean(),
  /** The rate differs more than 10 % from the latest rate on or before its date (PRD §15). */
  deviationExceeded: z.boolean(),
});
export class UpsertExchangeRateResponseDto extends createZodDto(upsertExchangeRateResponseSchema) {}

export const loadDailyRatesResponseSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
});
export class LoadDailyRatesResponseDto extends createZodDto(loadDailyRatesResponseSchema) {}

export const importRatesResponseSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  /** 1-based positions in `rows` that failed validation, with i18n message keys. */
  errors: z.array(z.object({ row: z.number().int(), messages: z.array(z.string()) })),
});
export class ImportRatesResponseDto extends createZodDto(importRatesResponseSchema) {}

const selectedRateSchema = z.object({
  /** Units of the currency per 1 USD; equals `options[0].usdRate` outside USD. */
  usdRate: decimalStringSchema,
  /** Source of `usdRate`; `null` for USD. */
  source: rateSourceSchema.nullable(),
  /** True when `effectiveDate` is earlier than the requested date. */
  isFallback: z.boolean(),
  effectiveDate: dateOnlySchema,
  /** Every usable rate of `effectiveDate`, default first (BCV, then the latest created); empty for USD. */
  options: z.array(
    z.object({ source: rateSourceSchema, usdRate: decimalStringSchema, createdAt: z.string() }),
  ),
});

/** `rate` is `null` when no rate exists on or before the date: the user types it (DT-67). */
export const rateLookupResponseSchema = z.object({ rate: selectedRateSchema.nullable() });
export class RateLookupResponseDto extends createZodDto(rateLookupResponseSchema) {}

export function toExchangeRateResponse(rate: ExchangeRate): ExchangeRateResponseDto {
  return {
    id: rate.id,
    date: rate.date,
    currency: rate.currency,
    usdRate: rate.usdRate,
    source: rate.source,
    createdAt: rate.createdAt,
    createdById: rate.createdById,
  };
}

export function toUpsertResponse(result: UpsertExchangeRateResult): UpsertExchangeRateResponseDto {
  return {
    rate: toExchangeRateResponse(result.rate),
    created: result.created,
    deviationExceeded: result.deviationExceeded,
  };
}

export function toImportResponse(result: ImportRatesCsvResult): ImportRatesResponseDto {
  return {
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors.map((error) => ({ row: error.row, messages: [...error.messages] })),
  };
}

type LookedUpRate = Awaited<ReturnType<GetRateFor['execute']>>;

export function toLookupResponse(rate: LookedUpRate): RateLookupResponseDto {
  return {
    rate: rate && {
      usdRate: rate.usdRate,
      source: rate.source,
      isFallback: rate.isFallback,
      effectiveDate: rate.effectiveDate,
      options: rate.options.map((option) => ({
        source: option.source,
        usdRate: option.usdRate,
        createdAt: option.createdAt,
      })),
    },
  };
}
