import { describe, expect, it } from 'vitest';
import {
  businessMonthOf,
  dashboardPeriodRange,
  isMonthKey,
  trailingMonths,
} from './dashboard-period';

const TODAY = '2026-10-09';

describe('month', () => {
  it('a running month closes today and compares with the previous close', () => {
    expect(dashboardPeriodRange('month', '2026-10', TODAY)).toEqual({
      period: 'month',
      start: '2026-10-01',
      end: '2026-10-31',
      close: TODAY,
      previous: { start: '2026-09-01', end: '2026-09-30', close: '2026-09-30' },
    });
  });

  it('a past month closes on its last day', () => {
    expect(dashboardPeriodRange('month', '2026-08', TODAY)).toMatchObject({
      start: '2026-08-01',
      end: '2026-08-31',
      close: '2026-08-31',
      previous: { start: '2026-07-01', end: '2026-07-31', close: '2026-07-31' },
    });
  });

  it('January looks back to December and a leap February ends on the 29th', () => {
    expect(dashboardPeriodRange('month', '2026-01', TODAY).previous).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
      close: '2025-12-31',
    });
    expect(dashboardPeriodRange('month', '2028-02', '2028-06-01')).toMatchObject({
      end: '2028-02-29',
      close: '2028-02-29',
    });
  });

  it('the last day of the month is the close of a running month', () => {
    expect(dashboardPeriodRange('month', '2026-10', '2026-10-31').close).toBe('2026-10-31');
  });
});

describe('quarter', () => {
  it('any month of a quarter anchors the same calendar quarter', () => {
    for (const month of ['2026-10', '2026-11', '2026-12']) {
      expect(dashboardPeriodRange('quarter', month, '2027-01-15')).toMatchObject({
        start: '2026-10-01',
        end: '2026-12-31',
        close: '2026-12-31',
        previous: { start: '2026-07-01', end: '2026-09-30', close: '2026-09-30' },
      });
    }
  });

  it('every quarter boundary', () => {
    const edges = (month: string) => {
      const range = dashboardPeriodRange('quarter', month, '2030-01-01');
      return [range.start, range.end];
    };
    expect(edges('2026-01')).toEqual(['2026-01-01', '2026-03-31']);
    expect(edges('2026-03')).toEqual(['2026-01-01', '2026-03-31']);
    expect(edges('2026-04')).toEqual(['2026-04-01', '2026-06-30']);
    expect(edges('2026-06')).toEqual(['2026-04-01', '2026-06-30']);
    expect(edges('2026-07')).toEqual(['2026-07-01', '2026-09-30']);
    expect(edges('2026-09')).toEqual(['2026-07-01', '2026-09-30']);
  });

  it("January's previous quarter is the last of the year before", () => {
    expect(dashboardPeriodRange('quarter', '2026-01', TODAY).previous).toEqual({
      start: '2025-10-01',
      end: '2025-12-31',
      close: '2025-12-31',
    });
    expect(dashboardPeriodRange('quarter', '2026-02', TODAY).previous.start).toBe('2025-10-01');
  });

  it('a running quarter closes today', () => {
    expect(dashboardPeriodRange('quarter', '2026-10', TODAY)).toMatchObject({
      end: '2026-12-31',
      close: TODAY,
    });
  });
});

describe('year', () => {
  it('is the calendar year of the anchor, closing today while it runs', () => {
    expect(dashboardPeriodRange('year', '2026-03', TODAY)).toEqual({
      period: 'year',
      start: '2026-01-01',
      end: '2026-12-31',
      close: TODAY,
      previous: { start: '2025-01-01', end: '2025-12-31', close: '2025-12-31' },
    });
  });

  it('a finished year closes on December 31', () => {
    expect(dashboardPeriodRange('year', '2025-06', TODAY)).toMatchObject({
      start: '2025-01-01',
      close: '2025-12-31',
      previous: { start: '2024-01-01', end: '2024-12-31', close: '2024-12-31' },
    });
  });
});

describe('anchor month', () => {
  it('accepts only real YYYY-MM months', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '2026-10-01', 'abc', '']) {
      expect(isMonthKey(bad), bad).toBe(false);
      expect(() => dashboardPeriodRange('month', bad, TODAY), bad).toThrow();
    }
  });

  it('rejects an unknown period', () => {
    expect(() => dashboardPeriodRange('week' as 'month', '2026-10', TODAY)).toThrow();
  });

  it('the current business month is the month of today', () => {
    expect(businessMonthOf(TODAY)).toBe('2026-10');
  });
});

describe('trailingMonths (A14)', () => {
  it('lists twelve months ending at the close month', () => {
    const months = trailingMonths('2026-10', 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-11');
    expect(months[11]).toBe('2026-10');
  });

  it('a past year ends at its own December, never in the future', () => {
    expect(trailingMonths('2025-12', 12)[0]).toBe('2025-01');
  });
});
