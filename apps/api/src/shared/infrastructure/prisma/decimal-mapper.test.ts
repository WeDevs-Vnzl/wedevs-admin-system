import { describe, expect, it } from 'vitest';
import { Money } from '../../domain/money';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToMoney,
  decimalToString,
  moneyToDecimal,
  stringToDecimal,
} from './decimal-mapper';

describe('decimal-mapper', () => {
  it('round-trips a decimal string exactly', () => {
    expect(decimalToString(stringToDecimal('1234.50'))).toBe('1234.5');
    expect(decimalToString(stringToDecimal('0.1'))).toBe('0.1');
    expect(decimalToString(stringToDecimal('12345678901234567.89'))).toBe('12345678901234567.89');
  });

  it('never goes through number or exponent notation', () => {
    expect(decimalToString(stringToDecimal('0.00000001'))).toBe('0.00000001');
    expect(decimalToString(stringToDecimal('100000000000000000000'))).toBe('100000000000000000000');
  });

  it('rejects non-decimal strings', () => {
    for (const bad of ['', 'abc', '1e3', '1,5', ' 1']) {
      expect(() => stringToDecimal(bad)).toThrow(RangeError);
    }
  });

  it('maps to and from Money', () => {
    const money = decimalToMoney(stringToDecimal('10.25'), 'USD');
    expect(money.toString()).toBe('10.25');
    expect(money.currency).toBe('USD');
    expect(moneyToDecimal(Money.of('7.10', 'USD').round()).toFixed(2)).toBe('7.10');
  });

  it('maps @db.Date to DateOnly and back', () => {
    const date = dateOnlyToDbDate('2026-10-24');
    expect(date.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(dbDateToDateOnly(date)).toBe('2026-10-24');
    expect(() => dateOnlyToDbDate('2026-02-30')).toThrow(RangeError);
  });
});
