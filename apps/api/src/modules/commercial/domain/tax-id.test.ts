import { describe, expect, it } from 'vitest';
import { isValidTaxIdFor, isValidVeRif, normalizeVeRif, storedTaxId, taxIdKey } from './tax-id';

describe('Venezuelan RIF', () => {
  it('accepts a type letter, 8 digits and a check digit, with or without dashes, in either case', () => {
    for (const value of ['J-30123456-7', 'j301234567', ' V123456789 ', 'G-20000000-0']) {
      expect(isValidVeRif(value)).toBe(true);
    }
  });

  it('rejects other letters, short numbers and free text', () => {
    for (const value of ['X-30123456-7', 'J-3012345-7', 'J-30123456', 'abc', '']) {
      expect(isValidVeRif(value)).toBe(false);
    }
  });

  it('normalizes to the canonical form and returns anything else trimmed', () => {
    expect(normalizeVeRif('v123456789')).toBe('V-12345678-9');
    expect(normalizeVeRif(' J-30123456-7 ')).toBe('J-30123456-7');
    expect(normalizeVeRif('  free text ')).toBe('free text');
  });
});

describe('tax id by country', () => {
  it('requires an RIF for VE and any text elsewhere', () => {
    expect(isValidTaxIdFor('VE', 'J-30123456-7')).toBe(true);
    expect(isValidTaxIdFor('VE', '900.123.456')).toBe(false);
    expect(isValidTaxIdFor('CO', '900.123.456-1')).toBe(true);
    expect(isValidTaxIdFor('CO', '   ')).toBe(false);
  });

  it('stores the canonical RIF for VE and the trimmed text elsewhere', () => {
    expect(storedTaxId('j301234567', 'VE')).toBe('J-30123456-7');
    expect(storedTaxId(' 900.123.456-1 ', 'CO')).toBe('900.123.456-1');
  });

  it('compares keys without case, spaces, dots or dashes', () => {
    expect(taxIdKey('J-30123456-7')).toBe(taxIdKey('j301234567'));
    expect(taxIdKey(' 900.123 456-1')).toBe('9001234561');
  });
});
