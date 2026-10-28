import { describe, expect, it } from 'vitest';
import {
  VALIDATION_MESSAGES,
  dateOnlySchema,
  idSchema,
  isValidDateOnly,
  moneyAmountSchema,
  rateSchema,
  timestampSchema,
  zodFieldErrors,
} from './common.schemas';
import { z } from 'zod';

const messages = (result: { error?: { issues: { message: string }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.message);

describe('idSchema', () => {
  it('accepts cuids and readable ids', () => {
    expect(idSchema.safeParse('clx9f3k2a0000abcd1234').success).toBe(true);
    expect(idSchema.safeParse('cli_kairos-studio').success).toBe(true);
  });

  it.each(['', 'a'.repeat(65), 'a b', '../etc'])('rejects %j', (value) => {
    expect(idSchema.safeParse(value).success).toBe(false);
  });
});

describe('dateOnlySchema', () => {
  it.each(['2026-10-09', '2024-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    '2026-13-01',
    '2026-00-10',
    '2026-02-30',
    '2025-02-29',
    '2026-1-1',
    '26-10-09',
    '2026-10-09T00:00:00Z',
    '09/10/2026',
    '',
  ])('rejects %j', (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(false);
  });

  it('reports the i18n key and exposes the predicate', () => {
    expect(messages(dateOnlySchema.safeParse('nope'))).toEqual([VALIDATION_MESSAGES.invalidDate]);
    expect(isValidDateOnly('2026-10-09')).toBe(true);
  });
});

describe('timestampSchema', () => {
  it('is strict ISO 8601 UTC', () => {
    for (const ok of ['2026-10-09T14:30:00.000Z', '2026-10-09T14:30:00Z']) {
      expect(timestampSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      '2026-10-09',
      '2026-10-09T14:30:00+02:00',
      '2026-10-09 14:30:00',
      '',
      'yesterday',
    ]) {
      expect(timestampSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(timestampSchema.safeParse(1760000000000).success).toBe(false);
  });
});

describe('moneyAmountSchema (decimal strings, at most 2 decimals)', () => {
  it('accepts canonical positive amounts by default', () => {
    for (const ok of ['1', '0.01', '1234.50', '9999999999999999.99']) {
      expect(moneyAmountSchema().safeParse(ok).success, ok).toBe(true);
    }
  });

  it('rejects numbers, non-canonical shapes and negative zero', () => {
    for (const bad of [1234.5, '', '01', '+1', '1e3', '1,000.00', '.5', '5.', ' 1', '-0']) {
      expect(moneyAmountSchema({ sign: 'any' }).safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it('reports the matching key per failure', () => {
    expect(messages(moneyAmountSchema().safeParse('abc'))).toEqual([
      VALIDATION_MESSAGES.invalidMoney,
    ]);
    expect(messages(moneyAmountSchema().safeParse('1.234'))).toEqual([
      VALIDATION_MESSAGES.moneyTooManyDecimals,
    ]);
    expect(messages(moneyAmountSchema().safeParse('12345678901234567'))).toEqual([
      VALIDATION_MESSAGES.moneyOutOfRange,
    ]);
    expect(messages(moneyAmountSchema().safeParse('0'))).toEqual([
      VALIDATION_MESSAGES.moneyMustBePositive,
    ]);
    expect(messages(moneyAmountSchema().safeParse('-1'))).toEqual([
      VALIDATION_MESSAGES.moneyMustBePositive,
    ]);
  });

  it('honours the sign option', () => {
    expect(moneyAmountSchema({ sign: 'nonNegative' }).safeParse('0').success).toBe(true);
    expect(messages(moneyAmountSchema({ sign: 'nonNegative' }).safeParse('-1'))).toEqual([
      VALIDATION_MESSAGES.moneyMustBeNonNegative,
    ]);
    expect(moneyAmountSchema({ sign: 'any' }).safeParse('-10.50').success).toBe(true);
  });
});

describe('rateSchema (decimal strings, at most 8 decimals)', () => {
  it('accepts positive rates up to 8 decimals', () => {
    for (const ok of ['1', '36.5', '0.00000001', '123456789012.12345678']) {
      expect(rateSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it('reports the matching key per failure', () => {
    expect(messages(rateSchema.safeParse('x'))).toEqual([VALIDATION_MESSAGES.invalidRate]);
    expect(messages(rateSchema.safeParse('-1'))).toEqual([VALIDATION_MESSAGES.invalidRate]);
    expect(messages(rateSchema.safeParse('1.123456789'))).toEqual([
      VALIDATION_MESSAGES.rateTooManyDecimals,
    ]);
    expect(messages(rateSchema.safeParse('1234567890123'))).toEqual([
      VALIDATION_MESSAGES.rateOutOfRange,
    ]);
    expect(messages(rateSchema.safeParse('0'))).toEqual([VALIDATION_MESSAGES.rateMustBePositive]);
    expect(rateSchema.safeParse(36.5).success).toBe(false);
  });
});

describe('zodFieldErrors', () => {
  it('keys by dotted path and uses _form for the root', () => {
    const schema = z
      .object({ lines: z.array(z.object({ qty: z.string().min(1) })) })
      .refine(() => false, { message: 'validation.invalid' });
    const parsed = schema.safeParse({ lines: [{ qty: '' }] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(zodFieldErrors(parsed.error)).toEqual({
        'lines.0.qty': ['validation.required'],
        _form: ['validation.invalid'],
      });
    }
  });
});
