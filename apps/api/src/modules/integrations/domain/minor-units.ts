import { ValidationFailedError, isDecimalString } from '../../../shared/domain';

/**
 * Provider amounts in minor units (A5, DT-194, C15). Stripe sends integer minor units; WeDevs keeps decimal
 * strings. Both directions work on digit strings and `bigint`, never on `number`, so the largest amount
 * Stripe accepts (and anything beyond `Number.MAX_SAFE_INTEGER`) converts without precision loss.
 */

const MAX_DECIMALS = 18;
const INTEGER = /^-?\d+$/;

function invalid(field: string): ValidationFailedError {
  return new ValidationFailedError({
    message: 'validation.money.invalid',
    fieldErrors: { [field]: ['validation.money.invalid'] },
  });
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS)
    throw invalid('decimals');
}

/** `amount` minor units of a currency with `decimals` fraction digits, as a fixed-scale decimal string. */
export function minorToDecimal(amount: string | bigint, decimals: number): string {
  assertDecimals(decimals);
  const text = typeof amount === 'bigint' ? amount.toString() : amount;
  if (!INTEGER.test(text)) throw invalid('amount');
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).replace(/^0+(?=\d)/, '');
  if (decimals === 0) return negative && digits !== '0' ? `-${digits}` : digits;
  const padded = digits.padStart(decimals + 1, '0');
  const integer = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  const isZero = /^0+$/.test(integer + fraction);
  return `${negative && !isZero ? '-' : ''}${integer}.${fraction}`;
}

/**
 * Decimal string to integer minor units. A fraction longer than `decimals` that is not all zeros is refused
 * rather than rounded: a link or payment amount must never change on its way to the provider.
 */
export function decimalToMinor(amount: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (!isDecimalString(amount)) throw invalid('amount');
  const negative = amount.startsWith('-');
  const [integerPart = '', fractionPart = ''] = (negative ? amount.slice(1) : amount).split('.');
  const extra = fractionPart.slice(decimals);
  if (/[^0]/.test(extra)) throw invalid('amount');
  const fraction = fractionPart.slice(0, decimals).padEnd(decimals, '0');
  const minor = BigInt(`${integerPart === '' ? '0' : integerPart}${fraction}`);
  return negative ? -minor : minor;
}
