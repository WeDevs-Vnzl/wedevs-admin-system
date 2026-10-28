import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from './domain-error';
import { isDecimalString, Money } from './money';

const usd = (value: string) => Money.of(value, 'USD');

describe('isDecimalString / Money.of', () => {
  it('accepts plain decimal strings', () => {
    for (const ok of ['0', '12', '12.5', '-3.20', '.5', '755.16']) {
      expect(isDecimalString(ok)).toBe(true);
      expect(usd(ok).toString()).toBeDefined();
    }
  });

  it('rejects separators, exponents, blanks, NaN and non-strings', () => {
    for (const bad of ['', ' ', '1,000.00', '1e5', '1.', '--1', 'abc', 'NaN', 'Infinity', '1 2']) {
      expect(isDecimalString(bad)).toBe(false);
      expect(() => usd(bad)).toThrow(ValidationFailedError);
    }
    expect(isDecimalString(12)).toBe(false);
    expect(isDecimalString(null)).toBe(false);
    expect(() => Money.of(12 as unknown as string, 'USD')).toThrow(ValidationFailedError);
  });

  it('requires an uppercase currency code of 3 to 5 letters (USDT included)', () => {
    for (const ok of ['USD', 'VES', 'EUR', 'COP', 'USDT']) {
      expect(Money.of('1', ok).currency).toBe(ok);
    }
    for (const bad of ['', 'us', 'usd', 'US1', 'TOOLONG']) {
      expect(() => Money.of('1', bad)).toThrow(ValidationFailedError);
    }
  });

  it('keeps full precision until rounded and normalizes the string', () => {
    expect(usd('1.234567').toString()).toBe('1.234567');
    expect(usd('.5').toString()).toBe('0.5');
    expect(usd('12').toString()).toBe('12');
  });

  it('zero builds a zero amount', () => {
    expect(Money.zero('VES').toString()).toBe('0');
    expect(Money.zero('VES').currency).toBe('VES');
  });
});

describe('round (ROUND_HALF_UP, 2 dp)', () => {
  it.each([
    ['1.005', '1.01'],
    ['1.004', '1.00'],
    ['2.675', '2.68'],
    ['0.125', '0.13'],
    ['0.115', '0.12'],
    ['1.015', '1.02'],
    ['-1.005', '-1.01'],
    ['-0.004', '0.00'],
    ['-0.005', '-0.01'],
    ['10', '10.00'],
    ['0', '0.00'],
    ['1234567890123456.785', '1234567890123456.79'],
  ])('rounds %s to %s', (input, expected) => {
    expect(usd(input).round().toString()).toBe(expected);
  });

  it('rounds to 8 dp when asked (rates)', () => {
    expect(usd('755.123456785').round(8).toString()).toBe('755.12345679');
    expect(usd('1').round(8).toString()).toBe('1.00000000');
  });

  it('is immutable', () => {
    const a = usd('1.005');
    a.round();
    expect(a.toString()).toBe('1.005');
  });
});

describe('sum / add / subtract / multiply', () => {
  it('sums exactly where floats drift', () => {
    expect(
      Money.sum([usd('0.1'), usd('0.2')], 'USD')
        .round()
        .toString(),
    ).toBe('0.30');
    expect(Money.sum([], 'USD').round().toString()).toBe('0.00');
    expect(
      Money.sum([usd('0.10'), usd('0.20'), usd('0.30'), usd('-0.60')], 'USD')
        .round()
        .toString(),
    ).toBe('0.00');
  });

  it('adds and subtracts', () => {
    expect(usd('0.1').add(usd('0.2')).round().toString()).toBe('0.30');
    expect(usd('100').subtract(usd('3')).round().toString()).toBe('97.00');
    expect(usd('0.3').subtract(usd('0.1')).round().toString()).toBe('0.20');
  });

  it('multiplies by a decimal-string factor and rounds half up (quantity × unitPrice)', () => {
    expect(usd('3').multiply('19.99').round().toString()).toBe('59.97');
    expect(usd('1.5').multiply('0.01').round().toString()).toBe('0.02');
    expect(usd('0.333').multiply('3').round().toString()).toBe('1.00');
  });

  it('rejects an invalid factor', () => {
    expect(() => usd('1').multiply('1e3')).toThrow(ValidationFailedError);
    expect(() => usd('1').multiply('')).toThrow(ValidationFailedError);
  });

  it('refuses mixed currencies with ValidationFailedError', () => {
    expect(() => usd('1').add(Money.of('1', 'VES'))).toThrow(ValidationFailedError);
    expect(() => usd('1').subtract(Money.of('1', 'VES'))).toThrow(ValidationFailedError);
    expect(() => usd('1').compare(Money.of('1', 'VES'))).toThrow(ValidationFailedError);
    expect(() => Money.sum([usd('1'), Money.of('1', 'VES')], 'USD')).toThrow(ValidationFailedError);
  });

  it('HU-13 CA2: 100 USD with 3 IGTF leaves 97 allocatable', () => {
    expect(usd('100').subtract(usd('3')).round().toString()).toBe('97.00');
    expect(usd('100').subtract(usd('0')).round().toString()).toBe('100.00');
  });
});

describe('compare / equals / sign helpers', () => {
  it('compares numerically, not lexically', () => {
    expect(usd('9.00').compare(usd('10.00'))).toBe(-1);
    expect(usd('10').compare(usd('10.00'))).toBe(0);
    expect(usd('10.01').compare(usd('10'))).toBe(1);
    expect(usd('10').equals(usd('10.00'))).toBe(true);
    expect(usd('10').equals(Money.of('10', 'VES'))).toBe(false);
  });

  it('detects zero and negative', () => {
    expect(usd('0.00').isZero()).toBe(true);
    expect(usd('0.01').isZero()).toBe(false);
    expect(usd('-0.01').isNegative()).toBe(true);
    expect(usd('-0').isNegative()).toBe(false);
    expect(usd('1').isNegative()).toBe(false);
  });
});
