import { describe, expect, it } from 'vitest';
import {
  ACCESS_KEY_LOCKOUT_MINUTES,
  ACCESS_KEY_MAX_FAILED_ATTEMPTS,
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
  SHARE_DOWNLOAD_TTL_SECONDS,
  SHARE_TOKEN_LENGTH,
  UNLOCK_COOKIE_MAX_AGE_SECONDS,
  isInLockoutWindow,
  isWellFormedShareToken,
  lockoutDecision,
  lockoutWindowStart,
  normalizeAccessKeyInput,
  shareCountersOf,
  shareStatusOn,
} from './share-link';

describe('constants (DT-45, C22, C23)', () => {
  it('match the validators', () => {
    expect(SHARE_TOKEN_LENGTH).toBe(43);
    expect(ACCESS_KEY_MIN_LENGTH).toBe(8);
    expect(ACCESS_KEY_MAX_LENGTH).toBe(128);
    expect(ACCESS_KEY_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(ACCESS_KEY_LOCKOUT_MINUTES).toBe(15);
    expect(SHARE_DOWNLOAD_TTL_SECONDS).toBe(300);
    expect(UNLOCK_COOKIE_MAX_AGE_SECONDS).toBe(12 * 60 * 60);
  });
});

describe('share token shape (a malformed token is a bare 404, never VALIDATION)', () => {
  it('accepts 43 base64url characters only', () => {
    expect(isWellFormedShareToken('A'.repeat(43))).toBe(true);
    expect(isWellFormedShareToken(`${'a-_9'.repeat(10)}abc`)).toBe(true);
    expect(isWellFormedShareToken('A'.repeat(42))).toBe(false);
    expect(isWellFormedShareToken('A'.repeat(44))).toBe(false);
    expect(isWellFormedShareToken(`${'A'.repeat(42)}+`)).toBe(false);
    expect(isWellFormedShareToken(`${'A'.repeat(42)}\n`)).toBe(false);
  });
});

describe('access key input', () => {
  it('trims and reports whether the length is acceptable', () => {
    expect(normalizeAccessKeyInput('  K7QM-2XRP  ')).toBe('K7QM-2XRP');
    expect(normalizeAccessKeyInput('short')).toBeNull();
    expect(normalizeAccessKeyInput(' 1234567 ')).toBeNull();
    expect(normalizeAccessKeyInput('x'.repeat(128))).toHaveLength(128);
    expect(normalizeAccessKeyInput('x'.repeat(129))).toBeNull();
  });
});

describe('shareStatusOn (derived, Caracas business day)', () => {
  const today = '2026-10-31';
  it('revoked wins, then expired after the last valid day', () => {
    expect(
      shareStatusOn({ revokedAt: '2026-10-01T00:00:00Z', expiresAt: '2020-01-01' }, today),
    ).toBe('REVOKED');
    expect(shareStatusOn({ revokedAt: null, expiresAt: '2026-10-30' }, today)).toBe('EXPIRED');
    expect(shareStatusOn({ revokedAt: null, expiresAt: '2026-10-31' }, today)).toBe('ACTIVE');
    expect(shareStatusOn({ revokedAt: null, expiresAt: null }, today)).toBe('ACTIVE');
  });
});

describe('unlock lockout (5 failures per link, document and IP hash in 15 minutes)', () => {
  it('counts the attempt and refuses without checking once the limit is passed', () => {
    expect(lockoutDecision(0)).toEqual({
      attempt: 1,
      refuseWithoutChecking: false,
      failureCode: 'ACCESS_KEY_INVALID',
    });
    expect(lockoutDecision(3)).toEqual({
      attempt: 4,
      refuseWithoutChecking: false,
      failureCode: 'ACCESS_KEY_INVALID',
    });
  });

  it('the failure that reaches the limit already answers ACCESS_KEY_LOCKED', () => {
    expect(lockoutDecision(4)).toEqual({
      attempt: 5,
      refuseWithoutChecking: false,
      failureCode: 'ACCESS_KEY_LOCKED',
    });
  });

  it('every later attempt is refused without checking the key', () => {
    expect(lockoutDecision(5)).toMatchObject({
      attempt: 6,
      refuseWithoutChecking: true,
      failureCode: 'ACCESS_KEY_LOCKED',
    });
    expect(lockoutDecision(50).refuseWithoutChecking).toBe(true);
  });

  it('the window is strictly newer than 15 minutes before now', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    expect(lockoutWindowStart(now).toISOString()).toBe('2026-10-31T11:45:00.000Z');
    expect(isInLockoutWindow(new Date('2026-10-31T11:45:00.001Z'), now)).toBe(true);
    expect(isInLockoutWindow(new Date('2026-10-31T11:45:00.000Z'), now)).toBe(false);
  });
});

describe('shareCountersOf', () => {
  const log = (event: 'VIEW' | 'DOWNLOAD' | 'UNLOCK' | 'UNLOCK_FAILED', createdAt: string) => ({
    event,
    createdAt,
  });
  it('counts per event and ignores a failed unlock for lastAccessedAt', () => {
    const result = shareCountersOf([
      log('VIEW', '2026-10-01T10:00:00.000Z'),
      log('VIEW', '2026-10-02T10:00:00.000Z'),
      log('DOWNLOAD', '2026-10-03T10:00:00.000Z'),
      log('UNLOCK', '2026-10-04T10:00:00.000Z'),
      log('UNLOCK_FAILED', '2026-10-05T10:00:00.000Z'),
    ]);
    expect(result.counters).toEqual({
      viewCount: 2,
      downloadCount: 1,
      unlockCount: 1,
      failedUnlockCount: 1,
    });
    expect(result.lastAccessedAt).toBe('2026-10-04T10:00:00.000Z');
  });

  it('is empty without logs', () => {
    expect(shareCountersOf([])).toEqual({
      counters: { viewCount: 0, downloadCount: 0, unlockCount: 0, failedUnlockCount: 0 },
      lastAccessedAt: null,
    });
  });
});
