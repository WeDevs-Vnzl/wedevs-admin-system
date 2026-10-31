import { isValidDateOnly, type DateOnly } from '../../../../../shared/domain/business-date';
import type { FieldErrors } from '../../../../../shared/domain/domain-error';
import { ACCOUNT_TYPE_VALUES } from '../../../../../shared/domain/enums';
import type { SearchIndexEntry } from '../../../../../shared/application/ports/search-index.port';
import {
  compareMoney,
  roundMoney,
  toUsd,
  type MoneyString,
} from '../../../../../shared/domain/money';
import type { SortSpec } from '../../../../../shared/domain/list-query';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import type { AccountRecord } from '../../ports/account.repository.port';

/** i18n keys of the account rules (namespace `accounts`; shape keys come from `validation`). */
export const ACCOUNT_MESSAGES = {
  sameAccount: 'accounts.validation.sameAccount',
  partnerRequired: 'accounts.validation.partnerRequired',
  adjustmentNonZero: 'accounts.validation.adjustmentNonZero',
  inactive: 'accounts.validation.inactive',
  currencyLocked: 'accounts.validation.currencyLocked',
  unknownCurrency: 'accounts.validation.unknownCurrency',
  usdRateMustBeOne: 'accounts.validation.usdRateMustBeOne',
  invalidType: 'accounts.validation.invalidType',
  invalidMoney: 'validation.money.invalid',
  moneyTooManyDecimals: 'validation.money.tooManyDecimals',
  moneyOutOfRange: 'validation.money.outOfRange',
  moneyMustBePositive: 'validation.money.mustBePositive',
  moneyMustBeNonNegative: 'validation.money.mustBeNonNegative',
  invalidRate: 'validation.rate.invalid',
  rateTooManyDecimals: 'validation.rate.tooManyDecimals',
  rateOutOfRange: 'validation.rate.outOfRange',
  rateMustBePositive: 'validation.rate.mustBePositive',
  invalidDate: 'validation.date.invalid',
  invalidCurrency: 'validation.currency.invalid',
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidSort: 'validation.sort.invalid',
} as const;

export const ACCOUNT_SORT_FIELDS = [
  'name',
  'type',
  'institution',
  'currency',
  'balance',
  'status',
] as const;
export const DEFAULT_ACCOUNT_SORT: SortSpec = { field: 'name', direction: 'asc' };

export const LEDGER_SORT_FIELDS = ['date', 'kind', 'amount', 'balance'] as const;
export const DEFAULT_LEDGER_SORT: SortSpec = { field: 'date', direction: 'asc' };

const CURRENCY_CODE = /^[A-Z][A-Z0-9]{2,9}$/;
const AMOUNT_SHAPE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const AMOUNT_RANGE = /^-?(?:0|[1-9]\d{0,15})(?:\.\d+)?$/; // Decimal(18, 2)
const AMOUNT_DECIMALS = /^-?\d+(?:\.\d{1,2})?$/;
const RATE_SHAPE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const RATE_RANGE = /^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/; // Decimal(20, 8)
const RATE_DECIMALS = /^\d+(?:\.\d{1,8})?$/;
const ZERO = /^-?0(?:\.0+)?$/;

export type AmountSign = 'positive' | 'nonNegative' | 'any';

/** Message keys for an amount: plain decimal, at most 2 decimals, within `Decimal(18,2)`, and the sign. */
export function amountErrors(value: unknown, sign: AmountSign): string[] {
  if (
    typeof value !== 'string' ||
    !AMOUNT_SHAPE.test(value) ||
    (value[0] === '-' && ZERO.test(value))
  ) {
    return [ACCOUNT_MESSAGES.invalidMoney];
  }
  if (!AMOUNT_RANGE.test(value)) return [ACCOUNT_MESSAGES.moneyOutOfRange];
  if (!AMOUNT_DECIMALS.test(value)) return [ACCOUNT_MESSAGES.moneyTooManyDecimals];
  if (sign === 'positive' && (value.startsWith('-') || ZERO.test(value))) {
    return [ACCOUNT_MESSAGES.moneyMustBePositive];
  }
  if (sign === 'nonNegative' && value.startsWith('-'))
    return [ACCOUNT_MESSAGES.moneyMustBeNonNegative];
  return [];
}

/** Message keys for a rate: > 0, at most 8 decimals. */
export function rateErrors(value: unknown): string[] {
  if (typeof value !== 'string' || !RATE_SHAPE.test(value)) return [ACCOUNT_MESSAGES.invalidRate];
  if (!RATE_RANGE.test(value)) return [ACCOUNT_MESSAGES.rateOutOfRange];
  if (!RATE_DECIMALS.test(value)) return [ACCOUNT_MESSAGES.rateTooManyDecimals];
  return ZERO.test(value) ? [ACCOUNT_MESSAGES.rateMustBePositive] : [];
}

/** The USD rate of a snapshot: a valid rate, and exactly 1 for USD itself (PRD §9.2). */
export function usdRateErrors(value: unknown, currency: string): string[] {
  const shape = rateErrors(value);
  if (shape.length > 0) return shape;
  return currency === 'USD' && compareMoney(value as string, '1') !== 0
    ? [ACCOUNT_MESSAGES.usdRateMustBeOne]
    : [];
}

export function dateErrors(value: unknown): string[] {
  return typeof value === 'string' && isValidDateOnly(value) ? [] : [ACCOUNT_MESSAGES.invalidDate];
}

export function currencyShapeErrors(value: unknown): string[] {
  return typeof value === 'string' && CURRENCY_CODE.test(value)
    ? []
    : [ACCOUNT_MESSAGES.invalidCurrency];
}

export function accountTypeErrors(value: unknown): string[] {
  return (ACCOUNT_TYPE_VALUES as readonly unknown[]).includes(value)
    ? []
    : [ACCOUNT_MESSAGES.invalidType];
}

/** Required text, trimmed, within `max` characters. */
export function requiredTextErrors(value: unknown, max: number): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [ACCOUNT_MESSAGES.required];
  return value.trim().length > max ? [ACCOUNT_MESSAGES.tooLong] : [];
}

export function optionalTextErrors(value: unknown, max: number): string[] {
  if (value === undefined || value === null) return [];
  return typeof value === 'string' && value.trim().length <= max ? [] : [ACCOUNT_MESSAGES.tooLong];
}

/** Blank optional text is stored as `null`. */
export function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function addErrors(errors: FieldErrors, path: string, messages: readonly string[]): void {
  if (messages.length > 0) errors[path] = [...(errors[path] ?? []), ...messages];
}

// ───────────────────────────── Masked identifier (C5) ─────────────────────────────

/** Characters the masker emits (and that an attacker could prepend to look "already masked"). */
const MASK_MARKS = /[•*…]/g;

/**
 * The exact shapes `maskAccountIdentifier` produces. Only a value that matches one of them counts as
 * already masked; a mask mark anywhere else is not trusted (`*0102-0123-45-6789012345` must not pass).
 */
const MASKED_SHAPES = [
  /^•••• \d{4}$/u, // numeric account: last 4 digits
  /^.{4}….{4}$/u, // wallet / e-mail: first 4 and last 4
  /^.….$/u, // short value: first and last character
  /^•+$/u, // 1-2 characters: all hidden
];

/**
 * Reduces an account identifier to what may be stored and shown (PRD §8.7, C5): only the last 4 digits of a
 * numeric account (`•••• 1234`), or the first and last characters of a wallet or e-mail (`0x1a…9f3c`).
 * Idempotent: a value that exactly matches an output shape is returned as is; anything else has its mask marks
 * stripped and is masked again, so a forged "mask" cannot smuggle a full number.
 */
export function maskAccountIdentifier(raw: string): string {
  const value = raw.trim();
  if (MASKED_SHAPES.some((shape) => shape.test(value))) return value;
  const chars = [...value.replace(MASK_MARKS, '').replace(/[\s-]/g, '')];
  const compact = chars.join('');
  if (/^\d+$/.test(compact)) return `•••• ${chars.slice(-4).join('')}`;
  if (chars.length >= 12) return `${chars.slice(0, 4).join('')}…${chars.slice(-4).join('')}`;
  if (chars.length >= 3) return `${chars[0]}…${chars[chars.length - 1]}`;
  return '•'.repeat(chars.length);
}

/**
 * The identifier to store: blank text keeps the stored value (`undefined`), `null` clears it, anything
 * else is masked here, whatever the caller already did (C5).
 */
export function identifierToStore(input: string | null | undefined): string | null | undefined {
  if (input === null) return null;
  const trimmed = input?.trim();
  return trimmed ? maskAccountIdentifier(trimmed) : undefined;
}

// ───────────────────────────── Output ─────────────────────────────

/** An account with its balance valued in USD at the rate of the day (`null` while the currency has none). */
export interface AccountOutput extends AccountRecord {
  readonly balanceUsd: MoneyString | null;
}

/**
 * Values balances in USD. The rate is read once per currency and date, so a page of accounts costs one
 * lookup per currency. A snapshot of a transaction is never produced here (C16): this is display only.
 */
export class AccountValuation {
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(private readonly rates: ExchangeRatePort) {}

  private rateOf(date: DateOnly, currency: string): Promise<string | null> {
    const key = `${date}:${currency}`;
    let rate = this.cache.get(key);
    if (!rate) {
      rate = this.rates.getRateFor(date, currency).then((found) => found?.usdRate ?? null);
      this.cache.set(key, rate);
    }
    return rate;
  }

  async usd(amount: MoneyString, currency: string, date: DateOnly): Promise<MoneyString | null> {
    const rate = await this.rateOf(date, currency);
    return rate === null ? null : toUsd(roundMoney(amount), rate);
  }

  async output(account: AccountRecord, date: DateOnly): Promise<AccountOutput> {
    return { ...account, balanceUsd: await this.usd(account.balance, account.currency, date) };
  }
}

/** The `ACCOUNT` search entry of an account (C12, DT-112). */
export function accountSearchEntry(account: AccountRecord): SearchIndexEntry {
  return {
    entityType: 'ACCOUNT',
    entityId: account.id,
    code: null,
    title: account.name,
    subtitle: [account.institution, account.currency].filter(Boolean).join(' · '),
    body: [account.institution, account.holderName, account.currency, account.notes]
      .filter((part): part is string => Boolean(part))
      .join(' '),
    status: account.active ? 'active' : 'inactive',
    archived: false,
  };
}

export const ACCOUNT_DIFF_FIELDS = [
  'name',
  'type',
  'institution',
  'currency',
  'identifierMasked',
  'holderName',
  'openingBalance',
  'openingDate',
  'active',
  'notes',
] as const;
