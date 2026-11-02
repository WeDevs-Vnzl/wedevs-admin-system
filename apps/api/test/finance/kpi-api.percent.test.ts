import { describe, expect, it } from 'vitest';
import { computeProjectMargin, percent } from '../../src/modules/finance/application/kpi-api';

describe('kpi-api percent (the single percentage formula, C17)', () => {
  it('is round(numerator x 100 / denominator, 2), half up', () => {
    expect(percent('200.00', '300.00')).toBe('66.67');
    expect(percent('100.00', '300.00')).toBe('33.33');
    expect(percent('1.00', '8.00')).toBe('12.50');
  });

  it('is null for a zero or negative denominator', () => {
    expect(percent('10.00', '0.00')).toBeNull();
    expect(percent('10.00', '-5.00')).toBeNull();
  });

  it('keeps the margin percent of stored columns: collected minus (collected minus margin)', () => {
    expect(computeProjectMargin({ collectedUsd: '300.00', allocatedExpensesUsd: '200.00' })).toBe(
      '33.33',
    );
    expect(computeProjectMargin({ collectedUsd: '200.00', allocatedExpensesUsd: '250.00' })).toBe(
      '-25.00',
    );
    expect(computeProjectMargin({ collectedUsd: '0.00', allocatedExpensesUsd: '0.00' })).toBeNull();
  });
});
