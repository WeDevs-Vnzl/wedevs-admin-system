import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain';
import {
  PAYMENT_LINK_MINIMUM,
  STRIPE_LINK_CURRENCIES,
  linkCapacity,
  linksToDeactivate,
  validateLinkRequest,
  type OpenLinkForCapacity,
} from './link-capacity';

const link = (
  id: string,
  amount: string,
  createdAt: string,
  status: 'PENDING' | 'ACTIVE' = 'ACTIVE',
): OpenLinkForCapacity => ({ id, amount, createdAt: new Date(createdAt), status });

function failure(fn: () => unknown): ValidationFailedError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationFailedError) return error;
    throw error;
  }
  throw new Error('expected ValidationFailedError');
}

describe('constants', () => {
  it('accepts USD and EUR with a 0.50 minimum (DT-197)', () => {
    expect([...STRIPE_LINK_CURRENCIES]).toEqual(['USD', 'EUR']);
    expect(PAYMENT_LINK_MINIMUM).toBe('0.50');
  });
});

describe('linkCapacity', () => {
  it('is the open balance with no links and nothing reserved', () => {
    expect(linkCapacity('100.00', [], '0')).toBe('100.00');
  });

  it('subtracts the open links and the reserved term (DT-199)', () => {
    const links = [
      link('a', '30.00', '2026-11-01T10:00:00Z'),
      link('b', '10.00', '2026-11-01T11:00:00Z', 'PENDING'),
    ];
    expect(linkCapacity('100.00', links, '0')).toBe('60.00');
    expect(linkCapacity('100.00', links, '25.50')).toBe('34.50');
  });

  it('is zero, never negative, when the links already exceed the balance', () => {
    expect(linkCapacity('50.00', [link('a', '80.00', '2026-11-01T10:00:00Z')], '0')).toBe('0.00');
  });

  it('rounds to cents and keeps two decimals', () => {
    expect(linkCapacity('0.30', [link('a', '0.10', '2026-11-01T10:00:00Z')], '0')).toBe('0.20');
  });

  it('rejects a non decimal string', () => {
    expect(() => linkCapacity('abc', [], '0')).toThrow(ValidationFailedError);
  });
});

describe('validateLinkRequest', () => {
  it('accepts exactly the capacity and returns the normalized amount', () => {
    expect(validateLinkRequest('USD', '40.00', '40.00')).toBe('40.00');
    expect(validateLinkRequest('EUR', '40', '40.00')).toBe('40.00');
  });

  it('accepts exactly the minimum', () => {
    expect(validateLinkRequest('USD', '0.50', '10.00')).toBe('0.50');
  });

  it('refuses 0.01 above the capacity', () => {
    const error = failure(() => validateLinkRequest('USD', '40.01', '40.00'));
    expect(error.fieldErrors).toEqual({ amount: ['validation.paymentLinkExceedsCapacity'] });
  });

  it('refuses 0.49, and zero or negative, as below the minimum', () => {
    for (const amount of ['0.49', '0', '-5']) {
      const error = failure(() => validateLinkRequest('USD', amount, '40.00'));
      expect(error.fieldErrors).toEqual({ amount: ['validation.paymentLinkBelowMinimum'] });
    }
  });

  it('reports the minimum before the capacity when the capacity is below the minimum', () => {
    const error = failure(() => validateLinkRequest('USD', '0.20', '0.30'));
    expect(error.fieldErrors).toEqual({ amount: ['validation.paymentLinkBelowMinimum'] });
    const above = failure(() => validateLinkRequest('USD', '0.50', '0.30'));
    expect(above.fieldErrors).toEqual({ amount: ['validation.paymentLinkExceedsCapacity'] });
  });

  it.each(['VES', 'USDT', 'GBP', 'usd'])('refuses the currency %s', (currency) => {
    const error = failure(() => validateLinkRequest(currency, '10.00', '40.00'));
    expect(error.message).toBe('validation.paymentLinkCurrencyUnsupported');
  });

  it('checks the currency before the amount', () => {
    const error = failure(() => validateLinkRequest('VES', '0.01', '0.00'));
    expect(error.message).toBe('validation.paymentLinkCurrencyUnsupported');
  });

  it('refuses an amount with more than two decimals or a non decimal', () => {
    for (const amount of ['10.005', '1e2', 'abc', '']) {
      const error = failure(() => validateLinkRequest('USD', amount, '40.00'));
      expect(error.fieldErrors).toEqual({ amount: ['validation.money.invalid'] });
    }
  });
});

describe('linksToDeactivate', () => {
  const now = new Date('2026-11-02T12:00:00Z');

  it('deactivates nothing when the links fit', () => {
    const links = [
      link('a', '30.00', '2026-11-02T08:00:00Z'),
      link('b', '20.00', '2026-11-02T09:00:00Z'),
    ];
    expect(linksToDeactivate('50.00', links, '0', { invoiceOpen: true, now })).toEqual([]);
  });

  it('deactivates the newest first until the sum fits', () => {
    const links = [
      link('old', '30.00', '2026-11-02T08:00:00Z'),
      link('mid', '30.00', '2026-11-02T09:00:00Z'),
      link('new', '30.00', '2026-11-02T10:00:00Z'),
    ];
    const out = linksToDeactivate('50.00', links, '0', { invoiceOpen: true, now });
    expect(out.map((item) => [item.linkId, item.reason])).toEqual([
      ['new', 'BALANCE_SHRUNK'],
      ['mid', 'BALANCE_SHRUNK'],
    ]);
  });

  it('counts the reserved term against the balance', () => {
    const links = [
      link('a', '30.00', '2026-11-02T08:00:00Z'),
      link('b', '30.00', '2026-11-02T09:00:00Z'),
    ];
    const out = linksToDeactivate('100.00', links, '50.00', { invoiceOpen: true, now });
    expect(out.map((item) => item.linkId)).toEqual(['b']);
  });

  it('keeps a link whose amount exactly fills the remaining balance', () => {
    const links = [link('a', '40.00', '2026-11-02T08:00:00Z')];
    expect(linksToDeactivate('100.00', links, '60.00', { invoiceOpen: true, now })).toEqual([]);
  });

  it('deactivates every open link when the invoice is not open', () => {
    const links = [
      link('a', '1.00', '2026-11-02T08:00:00Z'),
      link('b', '2.00', '2026-11-02T09:00:00Z', 'PENDING'),
    ];
    const out = linksToDeactivate('0.00', links, '0', { invoiceOpen: false, now });
    expect(out.map((item) => [item.linkId, item.reason])).toEqual([
      ['b', 'INVOICE_NOT_OPEN'],
      ['a', 'INVOICE_NOT_OPEN'],
    ]);
  });

  it('deactivates PENDING links older than 24 hours, and only those', () => {
    const links = [
      link('stale', '10.00', '2026-11-01T11:59:59Z', 'PENDING'),
      link('exact', '10.00', '2026-11-01T12:00:00Z', 'PENDING'),
      link('active-old', '10.00', '2026-10-01T12:00:00Z', 'ACTIVE'),
    ];
    const out = linksToDeactivate('100.00', links, '0', { invoiceOpen: true, now });
    expect(out.map((item) => [item.linkId, item.reason])).toEqual([['stale', 'PENDING_EXPIRED']]);
  });

  it('does not count an expired link in the shrink pass', () => {
    const links = [
      link('stale', '60.00', '2026-10-30T00:00:00Z', 'PENDING'),
      link('fresh', '60.00', '2026-11-02T09:00:00Z'),
    ];
    const out = linksToDeactivate('100.00', links, '0', { invoiceOpen: true, now });
    expect(out.map((item) => item.linkId)).toEqual(['stale']);
  });

  it('breaks a creation-time tie by the larger id first, deterministically', () => {
    const links = [
      link('a', '30.00', '2026-11-02T08:00:00Z'),
      link('b', '30.00', '2026-11-02T08:00:00Z'),
    ];
    const out = linksToDeactivate('30.00', links, '0', { invoiceOpen: true, now });
    expect(out.map((item) => item.linkId)).toEqual(['b']);
  });

  it('deactivates everything when the reserved term exceeds the balance', () => {
    const links = [link('a', '10.00', '2026-11-02T08:00:00Z')];
    const out = linksToDeactivate('10.00', links, '25.00', { invoiceOpen: true, now });
    expect(out.map((item) => item.linkId)).toEqual(['a']);
  });
});
