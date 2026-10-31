import { describe, expect, it } from 'vitest';
import {
  FINANCE_FACT_KIND_VALUES,
  FINANCE_FACT_SOURCE_VALUES,
  splitByNetAmount,
  splitProportionally,
} from './finance-fact';
import { sumMoney } from '../../../shared/domain/money';

describe('FinanceFactKind / FinanceFactSource (DT-104)', () => {
  it('lists the Prisma enum values in declaration order', () => {
    expect(FINANCE_FACT_KIND_VALUES).toEqual([
      'BILLED',
      'COLLECTED',
      'EXPENSE_PAID',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'MOVEMENT_IN',
      'MOVEMENT_OUT',
      'IVA',
      'WITHHELD_IVA',
      'WITHHELD_ISLR',
      'WITHHELD_OTHER',
      'IGTF',
    ]);
    expect(FINANCE_FACT_SOURCE_VALUES).toEqual([
      'INVOICE',
      'PAYMENT',
      'EXPENSE',
      'TRANSFER',
      'MOVEMENT',
    ]);
  });
});

describe('splitProportionally', () => {
  it('splits proportionally to the weights', () => {
    expect(splitProportionally('100.00', ['1', '3'])).toEqual(['25.00', '75.00']);
  });

  it('a split always sums to its source (three equal weights of 100.00)', () => {
    const parts = splitProportionally('100.00', ['1', '1', '1']);
    expect(sumMoney(parts)).toBe('100.00');
  });

  it('gives the rounding residue to the largest weight', () => {
    // 10.00 * 1/3 = 3.33 (x2), 10.00 * 1/3 = 3.33; residue 0.01 goes to the largest
    expect(splitProportionally('10.00', ['1', '1', '2'])).toEqual(['2.50', '2.50', '5.00']);
    expect(splitProportionally('0.05', ['1', '1', '2'])).toEqual(['0.01', '0.01', '0.03']);
  });

  it('breaks ties on the largest weight with the first line', () => {
    // each half-cent rounds up to 0.01; the -0.01 residue lands on the first (largest, tie) line
    expect(splitProportionally('0.01', ['1', '1'])).toEqual(['0.00', '0.01']);
    expect(splitProportionally('100.00', ['1', '1', '1'])).toEqual(['33.34', '33.33', '33.33']);
  });

  it('puts everything on the first line when every weight is zero', () => {
    expect(splitProportionally('5.00', ['0', '0'])).toEqual(['5.00', '0.00']);
  });

  it('is exact for a zero total and for a single weight', () => {
    expect(splitProportionally('0', ['3', '4'])).toEqual(['0.00', '0.00']);
    expect(splitProportionally('12.34', ['7'])).toEqual(['12.34']);
  });

  it('returns an empty list for no weights and a zero total', () => {
    expect(splitProportionally('0', [])).toEqual([]);
  });

  it('rejects no weights with a non-zero total', () => {
    expect(() => splitProportionally('1.00', [])).toThrow(RangeError);
  });

  it('holds the sum invariant over many awkward cases', () => {
    const weights = ['33.33', '33.33', '33.34', '0.01', '1234.56'];
    for (const total of ['0.01', '1.00', '99.99', '1000.00', '123456.78']) {
      for (let size = 1; size <= weights.length; size += 1) {
        expect(sumMoney(splitProportionally(total, weights.slice(0, size)))).toBe(
          sumMoney([total]),
        );
      }
    }
  });
});

describe('splitByNetAmount (BILLED totalUsd / COLLECTED allocation amountUsd, Q-BE3-7)', () => {
  it('splits per line by netAmount and keeps each line project', () => {
    expect(
      splitByNetAmount('300.00', [
        { projectId: 'p1', netAmount: '100' },
        { projectId: 'p2', netAmount: '200' },
      ]),
    ).toEqual([
      { projectId: 'p1', amountUsd: '100.00' },
      { projectId: 'p2', amountUsd: '200.00' },
    ]);
  });

  it('sends the residue to the largest line so the split sums to the total', () => {
    const rows = splitByNetAmount('100.00', [
      { projectId: 'p1', netAmount: '1' },
      { projectId: 'p2', netAmount: '1' },
      { projectId: 'p3', netAmount: '1' },
    ]);
    expect(rows.map((row) => row.amountUsd)).toEqual(['33.34', '33.33', '33.33']);
    expect(sumMoney(rows.map((row) => row.amountUsd))).toBe('100.00');
  });

  it('keeps null-project lines as null-project rows without losing money', () => {
    const rows = splitByNetAmount('90.00', [
      { projectId: null, netAmount: '10' },
      { projectId: 'p1', netAmount: '20' },
    ]);
    expect(rows).toEqual([
      { projectId: null, amountUsd: '30.00' },
      { projectId: 'p1', amountUsd: '60.00' },
    ]);
    expect(sumMoney(rows.map((row) => row.amountUsd))).toBe('90.00');
  });

  it('keeps an invoice with only null-project lines whole', () => {
    expect(splitByNetAmount('12.50', [{ projectId: null, netAmount: '50' }])).toEqual([
      { projectId: null, amountUsd: '12.50' },
    ]);
  });

  it('keeps the whole amount on a null-project row when there are no lines', () => {
    expect(splitByNetAmount('12.50', [])).toEqual([{ projectId: null, amountUsd: '12.50' }]);
    expect(splitByNetAmount('0', [])).toEqual([]);
  });
});
