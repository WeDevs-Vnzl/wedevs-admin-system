import type { ShareEvent } from '../../../../shared/domain/enums';

export const SHARE_ACCESS_LOG = Symbol('SHARE_ACCESS_LOG');

export interface NewShareAccess {
  readonly id: string;
  readonly shareLinkId: string;
  readonly event: ShareEvent;
  readonly documentId: string | null;
  readonly ipHash: string;
  /** Already capped (512). */
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

/**
 * Append-only writer of `ShareAccessLog` (C20). Every write is valid only inside a unit of work.
 *
 * `append` also moves the stored counters of the link by an atomic increment in the same statement scope
 * (contract choice 4): `VIEW` adds to `viewCount`, `DOWNLOAD` to `downloadCount`, and both, like `UNLOCK`, set
 * `lastAccessedAt`. `UNLOCK_FAILED` touches no counter: a failed unlock is an attempt, not an access.
 */
export interface ShareAccessLogPort {
  append(entry: NewShareAccess): Promise<void>;
  /** A right key: the `UNLOCK_FAILED` row of the attempt becomes `UNLOCK` and the link's last access moves. */
  convertToUnlock(entryId: string, shareLinkId: string, at: Date): Promise<void>;
}
