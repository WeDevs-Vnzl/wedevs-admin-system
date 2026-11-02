import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain';
import { decimalToMinor, minorToDecimal } from './minor-units';

describe('minorToDecimal', () => {
  it.each([
    ['0', 0, '0'],
    ['1500', 0, '1500'],
    ['0', 2, '0.00'],
    ['1', 2, '0.01'],
    ['50', 2, '0.50'],
    ['123456', 2, '1234.56'],
    ['1', 3, '0.001'],
    ['1500', 3, '1.500'],
    ['-250', 2, '-2.50'],
  ])('converts %s minor units at %i decimals to %s', (minor, decimals, expected) => {
    expect(minorToDecimal(minor, decimals)).toBe(expected);
  });

  it('accepts a bigint', () => {
    expect(minorToDecimal(99_999_999_99n, 2)).toBe('99999999.99');
  });

  it('keeps the largest Stripe amount (99999999.99, 8 digits plus cents) without precision loss', () => {
    expect(minorToDecimal('9999999999', 2)).toBe('99999999.99');
  });

  it('keeps integers beyond Number.MAX_SAFE_INTEGER exact', () => {
    expect(minorToDecimal('9007199254740993', 2)).toBe('90071992547409.93');
    expect(minorToDecimal(9007199254740993n, 2)).toBe('90071992547409.93');
  });

  it.each(['', '1.5', '1e3', ' 12', 'abc', '--1', '1,000'])('rejects the amount %j', (minor) => {
    expect(() => minorToDecimal(minor, 2)).toThrow(ValidationFailedError);
  });

  it.each([-1, 1.5, 19, Number.NaN])('rejects %s decimals', (decimals) => {
    expect(() => minorToDecimal('100', decimals)).toThrow(ValidationFailedError);
  });
});

describe('decimalToMinor', () => {
  it.each([
    ['0', 0, 0n],
    ['1500', 0, 1500n],
    ['0.00', 2, 0n],
    ['0.01', 2, 1n],
    ['0.50', 2, 50n],
    ['1234.56', 2, 123456n],
    ['1.5', 2, 150n],
    ['1.500', 2, 150n],
    ['1.5', 3, 1500n],
    ['-2.50', 2, -250n],
    ['99999999.99', 2, 9999999999n],
  ])('converts %s at %i decimals to %s minor units', (amount, decimals, expected) => {
    expect(decimalToMinor(amount, decimals)).toBe(expected);
  });

  it('keeps integers beyond Number.MAX_SAFE_INTEGER exact', () => {
    expect(decimalToMinor('90071992547409.93', 2)).toBe(9007199254740993n);
  });

  it('refuses an amount with more fraction digits than the currency allows instead of rounding', () => {
    expect(() => decimalToMinor('10.005', 2)).toThrow(ValidationFailedError);
    expect(() => decimalToMinor('10.5', 0)).toThrow(ValidationFailedError);
  });

  it.each(['', '1e3', 'abc', '1,5', ' 1'])('rejects the amount %j', (amount) => {
    expect(() => decimalToMinor(amount, 2)).toThrow(ValidationFailedError);
  });

  it('rejects an invalid decimals count', () => {
    expect(() => decimalToMinor('1', -1)).toThrow(ValidationFailedError);
    expect(() => decimalToMinor('1', 2.5)).toThrow(ValidationFailedError);
  });

  it('round-trips with minorToDecimal', () => {
    for (const [minor, decimals] of [
      ['1', 2],
      ['9999999999', 2],
      ['1234567', 3],
      ['42', 0],
    ] as const) {
      expect(decimalToMinor(minorToDecimal(minor, decimals), decimals)).toBe(BigInt(minor));
    }
  });
});
