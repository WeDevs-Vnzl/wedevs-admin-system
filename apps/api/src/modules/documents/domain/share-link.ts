import type { DateOnly } from '../../../shared/domain/business-date';
import type { ShareEvent } from '../../../shared/domain/enums';

/**
 * Share links and the portal (PRD §8.11, DT-45, C22). Ported from `validators/shares.ts`, `fixtures/shares.ts`
 * and the lockout of `portal-shares.ts`. Pure: instants and dates arrive as parameters.
 */

/** Share tokens are 32 random bytes in base64url: 43 characters. */
export const SHARE_TOKEN_LENGTH = 43;
const SHARE_TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${SHARE_TOKEN_LENGTH}}$`);

export const ACCESS_KEY_MIN_LENGTH = 8;
export const ACCESS_KEY_MAX_LENGTH = 128;
export const ACCESS_KEY_MAX_FAILED_ATTEMPTS = 5;
export const ACCESS_KEY_LOCKOUT_MINUTES = 15;

/** Portal downloads live 5 minutes (C23, PRD:975). */
export const SHARE_DOWNLOAD_TTL_SECONDS = 300;

/** The unlock cookie lasts 12 h at most. */
export const UNLOCK_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export type ShareStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

/** A malformed token is the same bare 404 as an unknown one, never `VALIDATION` (C22). */
export function isWellFormedShareToken(token: string): boolean {
  return SHARE_TOKEN_PATTERN.test(token);
}

/** The trimmed key typed by the visitor, or `null` outside 8-128 characters (a DTO `VALIDATION`, not an attempt). */
export function normalizeAccessKeyInput(raw: string): string | null {
  const key = raw.trim();
  if (key.length < ACCESS_KEY_MIN_LENGTH || key.length > ACCESS_KEY_MAX_LENGTH) return null;
  return key;
}

/**
 * Status of a link on `today` (Caracas): revoked wins, then expired after its last valid day. Derived for filters,
 * sorts and portal refusal; `expiredAt` (DT-137) is only the step's marker.
 */
export function shareStatusOn(
  link: { readonly revokedAt: string | Date | null; readonly expiresAt: DateOnly | null },
  today: DateOnly,
): ShareStatus {
  if (link.revokedAt) return 'REVOKED';
  if (link.expiresAt && link.expiresAt < today) return 'EXPIRED';
  return 'ACTIVE';
}

// ───────────────────────────── Unlock lockout ─────────────────────────────

export type UnlockFailureCode = 'ACCESS_KEY_INVALID' | 'ACCESS_KEY_LOCKED';

export interface LockoutDecision {
  /** This attempt's ordinal inside the window (failures already counted + 1). */
  readonly attempt: number;
  /** Past the limit: answer `ACCESS_KEY_LOCKED` without checking the key, right key included. */
  readonly refuseWithoutChecking: boolean;
  /** What a wrong key answers: the failure that reaches the limit already answers `ACCESS_KEY_LOCKED`. */
  readonly failureCode: UnlockFailureCode;
}

/**
 * Decision for one unlock attempt given the `UNLOCK_FAILED` rows of this link, document and IP hash inside the
 * window. The attempt is counted before the key is checked, so parallel guesses cannot all pass the limit.
 */
export function lockoutDecision(failuresInWindow: number): LockoutDecision {
  const attempt = failuresInWindow + 1;
  return {
    attempt,
    refuseWithoutChecking: attempt > ACCESS_KEY_MAX_FAILED_ATTEMPTS,
    failureCode:
      attempt >= ACCESS_KEY_MAX_FAILED_ATTEMPTS ? 'ACCESS_KEY_LOCKED' : 'ACCESS_KEY_INVALID',
  };
}

/** Failures strictly newer than this instant count. */
export function lockoutWindowStart(now: Date): Date {
  return new Date(now.getTime() - ACCESS_KEY_LOCKOUT_MINUTES * 60_000);
}

export function isInLockoutWindow(failedAt: Date, now: Date): boolean {
  return failedAt.getTime() > lockoutWindowStart(now).getTime();
}

// ───────────────────────────── Counters ─────────────────────────────

export interface ShareCounters {
  readonly viewCount: number;
  readonly downloadCount: number;
  readonly unlockCount: number;
  readonly failedUnlockCount: number;
}

/**
 * Counters and last access derived from access-log rows (PRD §8.11 "Trazabilidad"). `lastAccessedAt` is the newest
 * successful access (`VIEW`, `DOWNLOAD`, `UNLOCK`); a failed unlock is an attempt, not an access.
 */
export function shareCountersOf(logs: readonly { event: ShareEvent; createdAt: string }[]): {
  counters: ShareCounters;
  lastAccessedAt: string | null;
} {
  let viewCount = 0;
  let downloadCount = 0;
  let unlockCount = 0;
  let failedUnlockCount = 0;
  let lastAccessedAt: string | null = null;
  for (const log of logs) {
    if (log.event === 'VIEW') viewCount += 1;
    else if (log.event === 'DOWNLOAD') downloadCount += 1;
    else if (log.event === 'UNLOCK') unlockCount += 1;
    else failedUnlockCount += 1;
    if (log.event !== 'UNLOCK_FAILED' && (!lastAccessedAt || log.createdAt > lastAccessedAt)) {
      lastAccessedAt = log.createdAt;
    }
  }
  return {
    counters: { viewCount, downloadCount, unlockCount, failedUnlockCount },
    lastAccessedAt,
  };
}
