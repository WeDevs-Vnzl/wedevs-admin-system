import { describe, expect, it } from 'vitest';
import {
  addDays,
  BUSINESS_TIME_ZONE,
  daysBetween,
  isBusinessDay,
  isValidDateOnly,
  parseDateOnly,
  todayInCaracas,
  toDateOnly,
} from './business-date';

describe('BUSINESS_TIME_ZONE', () => {
  it('is America/Caracas', () => {
    expect(BUSINESS_TIME_ZONE).toBe('America/Caracas');
  });
});

describe('todayInCaracas (UTC-4, no DST)', () => {
  it('is still the previous day between 00:00 and 03:59 UTC', () => {
    expect(todayInCaracas(new Date('2026-03-10T00:00:00Z'))).toBe('2026-03-09');
    expect(todayInCaracas(new Date('2026-03-10T03:59:59Z'))).toBe('2026-03-09');
  });

  it('rolls over at 04:00 UTC', () => {
    expect(todayInCaracas(new Date('2026-03-10T04:00:00Z'))).toBe('2026-03-10');
    expect(todayInCaracas(new Date('2026-03-10T23:59:59Z'))).toBe('2026-03-10');
  });

  it('crosses year and month boundaries', () => {
    expect(todayInCaracas(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
    expect(todayInCaracas(new Date('2026-03-01T03:00:00Z'))).toBe('2026-02-28');
  });

  it('does not depend on the process zone', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      expect(todayInCaracas(new Date('2026-03-10T03:00:00Z'))).toBe('2026-03-09');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('toDateOnly', () => {
  it('defaults to Caracas and accepts another zone', () => {
    const instant = new Date('2026-03-10T02:00:00Z');
    expect(toDateOnly(instant)).toBe('2026-03-09');
    expect(toDateOnly(instant, 'UTC')).toBe('2026-03-10');
    expect(toDateOnly(instant, 'Asia/Tokyo')).toBe('2026-03-10');
  });

  it('zero-pads month and day', () => {
    expect(toDateOnly(new Date('2026-01-05T12:00:00Z'), 'UTC')).toBe('2026-01-05');
  });
});

describe('isValidDateOnly', () => {
  it('accepts real calendar dates', () => {
    expect(isValidDateOnly('2026-10-09')).toBe(true);
    expect(isValidDateOnly('2028-02-29')).toBe(true);
  });

  it('rejects malformed and impossible dates', () => {
    for (const bad of [
      '',
      '2026-3-10',
      '10/03/2026',
      '2026-13-01',
      '2026-00-10',
      '2026-03-32',
      '2026-02-29',
      '2026-02-30',
    ]) {
      expect(isValidDateOnly(bad)).toBe(false);
    }
  });
});

describe('parseDateOnly', () => {
  it('returns midnight UTC', () => {
    expect(parseDateOnly('2026-03-10').toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('accepts a leap day only in leap years', () => {
    expect(parseDateOnly('2028-02-29').toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(() => parseDateOnly('2026-02-29')).toThrow(RangeError);
  });

  it('rejects malformed values', () => {
    for (const bad of ['', '2026-3-10', '10/03/2026', '2026-13-01', '2026-00-10', '2026-03-32']) {
      expect(() => parseDateOnly(bad)).toThrow(RangeError);
    }
  });
});

describe('addDays / daysBetween', () => {
  it('adds across months, years and leap days', () => {
    expect(addDays('2026-03-10', 30)).toBe('2026-04-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-10', -10)).toBe('2026-02-28');
    expect(addDays('2026-03-10', 0)).toBe('2026-03-10');
  });

  it('counts calendar days with sign', () => {
    expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0);
    expect(daysBetween('2026-03-10', '2026-03-15')).toBe(5);
    expect(daysBetween('2026-03-15', '2026-03-10')).toBe(-5);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe.each(['Europe/Madrid', 'America/New_York'])(
  'addDays / daysBetween under TZ=%s',
  (zone) => {
    it('is not shifted by a DST change', () => {
      const original = process.env.TZ;
      process.env.TZ = zone;
      try {
        expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
        expect(addDays('2026-03-27', 2)).toBe('2026-03-29');
        expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
        expect(addDays('2026-03-10', 30)).toBe('2026-04-09');
        expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
        expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
        expect(addDays('2026-03-09', -2)).toBe('2026-03-07');
        expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
        expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
        expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
        expect(daysBetween('2026-03-09', '2026-03-07')).toBe(-2);
        expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    });
  },
);

describe('isBusinessDay', () => {
  it('is Monday to Friday', () => {
    expect(isBusinessDay('2026-03-09')).toBe(true);
    expect(isBusinessDay('2026-03-13')).toBe(true);
    expect(isBusinessDay('2026-03-14')).toBe(false);
    expect(isBusinessDay('2026-03-15')).toBe(false);
  });
});
