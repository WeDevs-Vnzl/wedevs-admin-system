export const RATE_LIMIT = Symbol('RATE_LIMIT');

export interface UnlockFailureWindow {
  readonly shareLinkId: string;
  readonly documentId: string;
  /** Salted IP hash of the visitor (C20). */
  readonly ipHash: string;
  /** Only failures strictly newer than this instant count. */
  readonly since: Date;
}

/**
 * The access-key lockout counter (DT-45): failed unlocks of one link, document and visitor inside the window,
 * counted from `ShareAccessLog` so a restart forgets nothing. Called inside the Serializable unit of work that
 * holds the `ShareLink` row lock, so parallel guesses cannot all pass the limit check.
 */
export interface RateLimitPort {
  countFailures(window: UnlockFailureWindow): Promise<number>;
}
