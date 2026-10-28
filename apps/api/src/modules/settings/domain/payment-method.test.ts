import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  PAYMENT_METHOD_MESSAGES,
  assertPaymentMethodCode,
  assertUniquePaymentMethod,
  normalizePaymentMethodFields,
  paymentMethodChanges,
  paymentMethodCreationChanges,
  sortPaymentMethods,
  type PaymentMethod,
} from './payment-method';

const EFECTIVO: PaymentMethod = {
  id: 'pmt_1',
  code: 'EFECTIVO_VES',
  name: 'Efectivo Bs.',
  nameEn: 'Cash VES',
  requiresReference: false,
  suggestsIgtf: false,
  active: true,
};
const ZELLE: PaymentMethod = {
  ...EFECTIVO,
  id: 'pmt_2',
  code: 'ZELLE',
  name: 'Zelle',
  nameEn: null,
};

function fieldErrorsOf(action: () => unknown): Record<string, string[]> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationFailedError || error instanceof ConflictError) {
      return error.fieldErrors ?? {};
    }
    throw error;
  }
  return {};
}

describe('payment method rules (catalogs.test "payment methods")', () => {
  it('accepts a method and applies the defaults requiresReference true, suggestsIgtf false, active true', () => {
    expect(normalizePaymentMethodFields({ name: 'Zelle' })).toEqual({
      name: 'Zelle',
      nameEn: null,
      requiresReference: true,
      suggestsIgtf: false,
      active: true,
    });
  });

  it('rejects a lower-case code and a blank name', () => {
    expect(fieldErrorsOf(() => assertPaymentMethodCode('zelle'))).toEqual({
      code: [PAYMENT_METHOD_MESSAGES.invalidCode],
    });
    expect(fieldErrorsOf(() => normalizePaymentMethodFields({ name: '  ' }))).toEqual({
      name: [PAYMENT_METHOD_MESSAGES.required],
    });
  });

  it('accepts the stable code shape ZELLE and PAGO_MOVIL', () => {
    expect(() => assertPaymentMethodCode('ZELLE')).not.toThrow();
    expect(() => assertPaymentMethodCode('PAGO_MOVIL')).not.toThrow();
  });

  it('turns a blank English name into null', () => {
    expect(normalizePaymentMethodFields({ name: 'Zelle', nameEn: '  ' }).nameEn).toBeNull();
  });
});

describe('payment method uniqueness', () => {
  it('refuses a repeated code and a repeated name (case-insensitive) with CONFLICT on both fields', () => {
    expect(
      fieldErrorsOf(() =>
        assertUniquePaymentMethod([EFECTIVO, ZELLE], { code: 'ZELLE', name: 'zelle' }),
      ),
    ).toEqual({
      code: [PAYMENT_METHOD_MESSAGES.codeTaken],
      name: [PAYMENT_METHOD_MESSAGES.nameTaken],
    });
  });

  it('lets an update keep its own name', () => {
    expect(() =>
      assertUniquePaymentMethod([EFECTIVO, ZELLE], { name: 'Zelle' }, 'pmt_2'),
    ).not.toThrow();
  });

  it('refuses another method name on update', () => {
    expect(
      fieldErrorsOf(() =>
        assertUniquePaymentMethod([EFECTIVO, ZELLE], { name: 'Efectivo Bs.' }, 'pmt_2'),
      ),
    ).toEqual({ name: [PAYMENT_METHOD_MESSAGES.nameTaken] });
  });
});

describe('payment method change sets (DT-70: suggestsIgtf)', () => {
  it('records a creation as one paymentMethod entry', () => {
    expect(paymentMethodCreationChanges('BINANCE_PAY')).toEqual({
      paymentMethod: [null, 'BINANCE_PAY'],
    });
  });

  it('records the changed flags and name, and nothing for an identical write', () => {
    const next = { ...EFECTIVO, name: 'Efectivo Bs.', suggestsIgtf: true, active: false };
    const { id: _id, code: _code, ...fields } = next;
    expect(paymentMethodChanges(EFECTIVO, fields)).toEqual({
      suggestsIgtf: [false, true],
      active: [true, false],
    });
    const { id: _same, code: _sameCode, ...unchanged } = EFECTIVO;
    expect(paymentMethodChanges(EFECTIVO, unchanged)).toBeNull();
  });
});

describe('payment method list order', () => {
  it('orders by name, locale-aware', () => {
    expect(sortPaymentMethods([ZELLE, EFECTIVO]).map((row) => row.name)).toEqual([
      'Efectivo Bs.',
      'Zelle',
    ]);
  });
});
