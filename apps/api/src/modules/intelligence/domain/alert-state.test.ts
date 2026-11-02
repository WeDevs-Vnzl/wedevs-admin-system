import { describe, expect, it } from 'vitest';
import {
  alertLimit,
  assertMarkReadKeys,
  assertSnoozeDays,
  isAlertHidden,
  snoozeUntil,
  toDismissalView,
} from './alert-state';

const NOW = new Date('2026-10-09T15:00:00.000Z');
const DAY = 86_400_000;

describe('isAlertHidden (DT-163)', () => {
  it('a row with neither dismissedAt nor dismissedUntil hides nothing', () => {
    expect(isAlertHidden({ dismissedAt: null, dismissedUntil: null }, NOW)).toBe(false);
  });

  it('dismissedAt set hides for good', () => {
    expect(
      isAlertHidden({ dismissedAt: new Date('2026-10-01T00:00:00Z'), dismissedUntil: null }, NOW),
    ).toBe(true);
  });

  it('dismissedUntil after now hides; at or before now does not', () => {
    expect(
      isAlertHidden({ dismissedAt: null, dismissedUntil: new Date(NOW.getTime() + 1) }, NOW),
    ).toBe(true);
    expect(isAlertHidden({ dismissedAt: null, dismissedUntil: new Date(NOW.getTime()) }, NOW)).toBe(
      false,
    );
    expect(
      isAlertHidden({ dismissedAt: null, dismissedUntil: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe(false);
  });

  it('dismissedAt wins over an expired snooze', () => {
    expect(
      isAlertHidden(
        {
          dismissedAt: new Date('2026-10-01T00:00:00Z'),
          dismissedUntil: new Date(NOW.getTime() - DAY),
        },
        NOW,
      ),
    ).toBe(true);
  });
});

describe('toDismissalView', () => {
  const key = 'INVOICE_OVERDUE:a';

  it('permanent dismissal maps to dismissedUntil null and inactive', () => {
    expect(
      toDismissalView(
        key,
        { dismissedAt: new Date('2026-10-01T00:00:00Z'), dismissedUntil: null },
        NOW,
      ),
    ).toEqual({ alertKey: key, dismissedUntil: null, active: false });
  });

  it('a running snooze carries its ISO instant and is inactive', () => {
    const until = new Date(NOW.getTime() + 3 * DAY);
    expect(toDismissalView(key, { dismissedAt: null, dismissedUntil: until }, NOW)).toEqual({
      alertKey: key,
      dismissedUntil: until.toISOString(),
      active: false,
    });
  });

  it('no row, an unhidden row or an expired snooze is active with dismissedUntil null', () => {
    const active = { alertKey: key, dismissedUntil: null, active: true };
    expect(toDismissalView(key, null, NOW)).toEqual(active);
    expect(toDismissalView(key, { dismissedAt: null, dismissedUntil: null }, NOW)).toEqual(active);
    expect(
      toDismissalView(key, { dismissedAt: null, dismissedUntil: new Date(NOW.getTime() - 1) }, NOW),
    ).toEqual(active);
  });
});

describe('snooze', () => {
  it('hides until now + days', () => {
    expect(snoozeUntil(NOW, 3).toISOString()).toBe(new Date(NOW.getTime() + 3 * DAY).toISOString());
  });

  it('needs 1 to 90 whole days', () => {
    expect(() => assertSnoozeDays(1)).not.toThrow();
    expect(() => assertSnoozeDays(90)).not.toThrow();
    for (const days of [0, -3, 91, 1.5, Number.NaN]) {
      expect(() => assertSnoozeDays(days), String(days)).toThrow();
      expect(() => snoozeUntil(NOW, days), String(days)).toThrow();
    }
  });

  it('throws a validation error carrying an i18n key', () => {
    try {
      assertSnoozeDays(91);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { days: ['alerts.validation.snoozeDays'] },
      });
    }
  });
});

describe('alertLimit', () => {
  it('defaults to 50 and accepts 1 to 200', () => {
    expect(alertLimit(undefined)).toBe(50);
    expect(alertLimit(1)).toBe(1);
    expect(alertLimit(200)).toBe(200);
  });

  it('rejects 0, 201 and non-integers', () => {
    for (const limit of [0, 201, 1.5, -1]) {
      expect(() => alertLimit(limit), String(limit)).toThrow();
    }
  });
});

describe('assertMarkReadKeys', () => {
  it('returns the unique keys of a batch of one to 200 valid keys', () => {
    expect(
      assertMarkReadKeys(['INVOICE_OVERDUE:a', 'INVOICE_OVERDUE:a', 'MISSING_RATE:VES:2026-10-09']),
    ).toEqual(['INVOICE_OVERDUE:a', 'MISSING_RATE:VES:2026-10-09']);
  });

  it('rejects an empty batch, a malformed key and more than 200', () => {
    expect(() => assertMarkReadKeys([])).toThrow();
    expect(() => assertMarkReadKeys(['NOPE:x'])).toThrow();
    const many = Array.from({ length: 201 }, (_, i) => `INVOICE_OVERDUE:inv_${i}`);
    expect(() => assertMarkReadKeys(many)).toThrow();
    expect(assertMarkReadKeys(many.slice(0, 200))).toHaveLength(200);
  });
});
