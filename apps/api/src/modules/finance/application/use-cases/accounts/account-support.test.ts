import { describe, expect, it } from 'vitest';
import {
  amountErrors,
  identifierToStore,
  maskAccountIdentifier,
  rateErrors,
  usdRateErrors,
} from './account-support';

describe('masked identifiers (ported from the FE validators, C5)', () => {
  it('keeps only the last 4 digits of a numeric account', () => {
    expect(maskAccountIdentifier('0134 5678 9012 3456 7890')).toBe('•••• 7890');
    expect(maskAccountIdentifier('0134-5678-90')).toBe('•••• 7890');
  });

  it('keeps the first and last characters of a wallet or address', () => {
    expect(maskAccountIdentifier('0x1a2b3c4d5e6f7a8b9c0d')).toBe('0x1a…9c0d');
    expect(maskAccountIdentifier('pay@acme.com')).toBe('pay@….com');
    expect(maskAccountIdentifier('abc')).toBe('a…c');
    expect(maskAccountIdentifier('ab')).toBe('••');
  });

  it('is idempotent and accepts as masked only the exact output shapes', () => {
    for (const masked of ['•••• 7890', '0x1a…9c0d', 'pay@….com', 'a…c', '••', '•']) {
      expect(maskAccountIdentifier(masked)).toBe(masked);
    }
    expect(maskAccountIdentifier(maskAccountIdentifier('0x1a2b3c4d5e6f7a8b9c0d'))).toBe(
      '0x1a…9c0d',
    );
  });

  it('re-masks a forged mask instead of trusting any mask mark (bypass)', () => {
    expect(maskAccountIdentifier('*0102-0123-45-6789012345')).toBe('•••• 2345');
    expect(maskAccountIdentifier('••••0102012345678901')).toBe('•••• 8901');
    expect(maskAccountIdentifier('•••• 0102012345678901')).toBe('•••• 8901');
    expect(maskAccountIdentifier('0102…6789012345')).toBe('•••• 2345');
    expect(maskAccountIdentifier('0x1a2b3c4d5e6f7a8b9c0d…')).toBe('0x1a…9c0d');
    expect(maskAccountIdentifier('*secret@acme.com')).toBe('secr….com');
    expect(maskAccountIdentifier('•••• 7890\n01020123456789')).not.toMatch(/0102/);
  });

  it('stores nothing for blank text (keep), null for null (clear) and the mask otherwise', () => {
    expect(identifierToStore(undefined)).toBeUndefined();
    expect(identifierToStore('   ')).toBeUndefined();
    expect(identifierToStore(null)).toBeNull();
    expect(identifierToStore('0134 5678 9012 3456 7890')).toBe('•••• 7890');
  });
});

describe('amount and rate rules the DTO repeats (lesson B2)', () => {
  it('accepts plain decimals with at most 2 decimals and checks the sign', () => {
    expect(amountErrors('10.50', 'positive')).toEqual([]);
    expect(amountErrors('0', 'nonNegative')).toEqual([]);
    expect(amountErrors('-3', 'any')).toEqual([]);
    expect(amountErrors('0', 'positive')).toEqual(['validation.money.mustBePositive']);
    expect(amountErrors('-1', 'nonNegative')).toEqual(['validation.money.mustBeNonNegative']);
    expect(amountErrors('1.234', 'any')).toEqual(['validation.money.tooManyDecimals']);
    expect(amountErrors('12345678901234567', 'any')).toEqual(['validation.money.outOfRange']);
    for (const bad of ['abc', '1e3', '-0', '', 5, null]) {
      expect(amountErrors(bad, 'any')).toEqual(['validation.money.invalid']);
    }
  });

  it('requires a positive rate with at most 8 decimals, and exactly 1 for USD', () => {
    expect(rateErrors('755.16')).toEqual([]);
    expect(rateErrors('0')).toEqual(['validation.rate.mustBePositive']);
    expect(rateErrors('1.123456789')).toEqual(['validation.rate.tooManyDecimals']);
    expect(rateErrors('x')).toEqual(['validation.rate.invalid']);
    expect(usdRateErrors('1', 'USD')).toEqual([]);
    expect(usdRateErrors('1.00', 'USD')).toEqual([]);
    expect(usdRateErrors('2', 'USD')).toEqual(['accounts.validation.usdRateMustBeOne']);
    expect(usdRateErrors('755.16', 'VES')).toEqual([]);
  });
});
