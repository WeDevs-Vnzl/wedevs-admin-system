import { describe, expect, it } from 'vitest';
import {
  REPORT_ID_VALUES,
  REPORT_RANGE_PRESET_VALUES,
  changePercent,
  monthsOf,
  parseReportSlug,
  previousPeriod,
  rangeClose,
  reportSlugOf,
  resolveReportRange,
} from './report-range';

const TODAY = '2026-10-09';

describe('presets resolve to whole calendar months from today (Caracas)', () => {
  const at = (preset: (typeof REPORT_RANGE_PRESET_VALUES)[number], today = TODAY) =>
    resolveReportRange({ preset }, today);

  it('lists the six presets', () => {
    expect([...REPORT_RANGE_PRESET_VALUES]).toEqual([
      'THIS_MONTH',
      'PREVIOUS_MONTH',
      'QUARTER',
      'YEAR',
      'LAST_12_MONTHS',
      'CUSTOM',
    ]);
  });

  it('THIS_MONTH and PREVIOUS_MONTH', () => {
    expect(at('THIS_MONTH')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(at('PREVIOUS_MONTH')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('PREVIOUS_MONTH crosses the year and ends on leap day', () => {
    expect(at('PREVIOUS_MONTH', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(at('PREVIOUS_MONTH', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('QUARTER is the calendar quarter of today, at every boundary', () => {
    expect(at('QUARTER')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(at('QUARTER', '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(at('QUARTER', '2026-03-31')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(at('QUARTER', '2026-04-01')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(at('QUARTER', '2026-09-30')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('YEAR is the calendar year', () => {
    expect(at('YEAR')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('LAST_12_MONTHS is the current month and the 11 before', () => {
    expect(at('LAST_12_MONTHS')).toEqual({ from: '2025-11-01', to: '2026-10-31' });
    expect(at('LAST_12_MONTHS', '2026-01-20')).toEqual({ from: '2025-02-01', to: '2026-01-31' });
  });

  it('CUSTOM is taken as is', () => {
    expect(
      resolveReportRange({ preset: 'CUSTOM', dateFrom: '2026-02-10', dateTo: '2026-03-05' }, TODAY),
    ).toEqual({ from: '2026-02-10', to: '2026-03-05' });
  });

  it('CUSTOM needs both dates, real and ordered, with i18n keys', () => {
    const fail = (filter: Parameters<typeof resolveReportRange>[0]) => {
      try {
        resolveReportRange(filter, TODAY);
      } catch (error) {
        return error;
      }
      return undefined;
    };
    expect(fail({ preset: 'CUSTOM', dateTo: '2026-03-05' })).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { dateFrom: ['reports.validation.customRangeRequired'] },
    });
    expect(fail({ preset: 'CUSTOM', dateFrom: '2026-03-05' })).toMatchObject({
      fieldErrors: { dateTo: ['reports.validation.customRangeRequired'] },
    });
    expect(fail({ preset: 'CUSTOM', dateFrom: '2026-03-06', dateTo: '2026-03-05' })).toMatchObject({
      fieldErrors: { dateTo: ['reports.validation.rangeInverted'] },
    });
    expect(fail({ preset: 'CUSTOM', dateFrom: '2026-02-30', dateTo: '2026-03-05' })).toMatchObject({
      fieldErrors: { dateFrom: ['validation.date.invalid'] },
    });
    expect(
      fail({ preset: 'CUSTOM', dateFrom: '2026-03-05', dateTo: '2026-03-05' }),
    ).toBeUndefined();
  });
});

describe('monthsOf', () => {
  it('lists the months of a range, crossing years', () => {
    expect(monthsOf({ from: '2025-11-01', to: '2026-02-28' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthsOf({ from: '2026-10-05', to: '2026-10-20' })).toEqual(['2026-10']);
  });
});

describe('previousPeriod', () => {
  it('whole months shift by months, same length', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(previousPeriod({ from: '2026-10-01', to: '2026-12-31' })).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    });
    expect(previousPeriod({ from: '2026-01-01', to: '2026-12-31' })).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it("January's previous month and quarter cross the year", () => {
    expect(previousPeriod({ from: '2026-01-01', to: '2026-01-31' })).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(previousPeriod({ from: '2026-01-01', to: '2026-03-31' })).toEqual({
      from: '2025-10-01',
      to: '2025-12-31',
    });
  });

  it('March goes back to a short February', () => {
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('other ranges shift by their length in days', () => {
    expect(previousPeriod({ from: '2026-02-10', to: '2026-02-19' })).toEqual({
      from: '2026-01-31',
      to: '2026-02-09',
    });
    expect(previousPeriod({ from: '2026-10-05', to: '2026-10-05' })).toEqual({
      from: '2026-10-04',
      to: '2026-10-04',
    });
  });
});

describe('rangeClose', () => {
  it('is the last day, or today while the range runs', () => {
    expect(rangeClose({ from: '2026-10-01', to: '2026-10-31' }, TODAY)).toBe(TODAY);
    expect(rangeClose({ from: '2026-09-01', to: '2026-09-30' }, TODAY)).toBe('2026-09-30');
    expect(rangeClose({ from: '2026-10-01', to: '2026-10-09' }, TODAY)).toBe(TODAY);
  });
});

describe('changePercent', () => {
  it('is (value - previous) / |previous| in percent, rounded to 2 dp', () => {
    expect(changePercent('150.00', '100.00')).toBe('50.00');
    expect(changePercent('50.00', '100.00')).toBe('-50.00');
    expect(changePercent('100.00', '100.00')).toBe('0.00');
    expect(changePercent('1.00', '3.00')).toBe('-66.67');
    expect(changePercent('0.30', '0.10')).toBe('200.00');
  });

  it('divides by the absolute previous value', () => {
    expect(changePercent('-50.00', '-100.00')).toBe('50.00');
    expect(changePercent('50.00', '-100.00')).toBe('150.00');
  });

  it('is null when either side is missing or the previous is zero', () => {
    expect(changePercent(null, '100.00')).toBeNull();
    expect(changePercent('100.00', null)).toBeNull();
    expect(changePercent('100.00', '0.00')).toBeNull();
    expect(changePercent('100.00', '0')).toBeNull();
  });
});

describe('report slugs', () => {
  it('are the kebab-case of the ten ids and round-trip', () => {
    expect(reportSlugOf('COLLECTED_BY_MONTH')).toBe('collected-by-month');
    for (const id of REPORT_ID_VALUES) expect(parseReportSlug(reportSlugOf(id))).toBe(id);
    expect(REPORT_ID_VALUES).toHaveLength(10);
  });

  it('rejects anything outside the whitelist', () => {
    for (const bad of ['', 'kpis', 'COLLECTED_BY_MONTH', 'collected_by_month', 'constructor']) {
      expect(parseReportSlug(bad), bad).toBeNull();
    }
  });
});
