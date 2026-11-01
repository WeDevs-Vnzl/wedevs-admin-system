import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import {
  AccessKeyInvalidError,
  AccessKeyLockedError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../../shared/domain/domain-error';
import {
  lockoutDecision,
  lockoutWindowStart,
  normalizeAccessKeyInput,
  shareStatusOn,
  UNLOCK_COOKIE_MAX_AGE_SECONDS,
  type UnlockFailureCode,
} from '../../../domain';
import type { RateLimitPort } from '../../ports/rate-limit.port';
import type { ShareAccessLogPort } from '../../ports/share-access-log.port';
import type { PortalSupport, PortalVisitor } from './portal-support';

export interface UnlockSharedDocumentInput {
  readonly token: string;
  readonly documentId: string;
  /** What the visitor typed. Trimmed and checked for 8-128 characters here, not only in the DTO. */
  readonly key: string;
  readonly visitor: PortalVisitor;
}

export interface UnlockSharedDocumentResult {
  readonly documentId: string;
  readonly unlocked: true;
  /**
   * The signed cookie value listing every document this visitor has unlocked in this link (the ones the
   * request's cookie already held plus this one); `null` when the document needs no key, so nothing is set.
   */
  readonly unlockCookie: string | null;
}

type Attempt =
  | { readonly kind: 'open' }
  | { readonly kind: 'locked' }
  | {
      readonly kind: 'checked';
      readonly entryId: string;
      readonly hash: string;
      readonly failureCode: UnlockFailureCode;
    };

/**
 * `unlockSharedDocument` (DT-45, A1). Order, because a check-then-count race would let parallel guesses all
 * pass the limit:
 *  1. one `Serializable` unit of work: `lock({ ShareLink })`, re-check that the link is live, count the
 *     failures of this link, document and IP hash inside the 15-minute window through `RateLimitPort`,
 *     refuse at the limit (right key included), insert `UNLOCK_FAILED`, commit;
 *  2. scrypt verification, outside any transaction (it takes ~100 ms and must not hold the row lock);
 *  3. on a right key, a second unit of work converts that row to `UNLOCK`.
 * A crash between 1 and 3 leaves a counted failure: the safe side. The clear key is never logged or stored.
 * A document without a key answers unlocked and writes no row.
 */
export class UnlockSharedDocument {
  constructor(
    private readonly support: PortalSupport,
    private readonly uow: UnitOfWorkPort,
    private readonly locks: RowLocksPort,
    private readonly rateLimit: RateLimitPort,
    private readonly accessLog: ShareAccessLogPort,
  ) {}

  async execute(input: UnlockSharedDocumentInput): Promise<UnlockSharedDocumentResult> {
    const key = normalizeAccessKeyInput(input.key ?? '');
    if (key === null) {
      // Not an attempt: nothing is counted or logged (contract choice 3).
      throw new ValidationFailedError({ fieldErrors: { key: ['validation.invalidFormat'] } });
    }
    const link = await this.support.liveLink(input.token);
    const document = await this.support.sharedDocument(link, input.documentId);
    const grantsBefore = this.support.unlockGrants(input.visitor, link.token);
    if (!document.requiresKey) {
      return { documentId: document.documentId, unlocked: true, unlockCookie: null };
    }

    const ipHash = this.support.ipHashOf(input.visitor);
    const attempt = await this.uow.run(
      async (): Promise<Attempt> => {
        await this.locks.lock({ ShareLink: [link.id] });
        const current = await this.support.shares.findById(link.id);
        if (!current || shareStatusOn(current, todayInCaracas(this.support.now())) !== 'ACTIVE') {
          throw new NotFoundError();
        }
        const hash = await this.support.shares.accessKeyHashOf(link.id, document.documentId);
        if (hash === null) return { kind: 'open' };
        const now = this.support.now();
        const decision = lockoutDecision(
          await this.rateLimit.countFailures({
            shareLinkId: link.id,
            documentId: document.documentId,
            ipHash,
            since: lockoutWindowStart(now),
          }),
        );
        if (decision.refuseWithoutChecking) return { kind: 'locked' };
        const entryId = this.support.nextId();
        await this.accessLog.append({
          id: entryId,
          shareLinkId: link.id,
          event: 'UNLOCK_FAILED',
          documentId: document.documentId,
          ipHash,
          userAgent: this.support.userAgentOf(input.visitor),
          createdAt: now,
        });
        return { kind: 'checked', entryId, hash, failureCode: decision.failureCode };
      },
      { isolation: 'Serializable' },
    );

    if (attempt.kind === 'locked') throw new AccessKeyLockedError();
    if (attempt.kind === 'checked') {
      if (!(await this.support.secrets.verifyKey(key, attempt.hash))) {
        throw attempt.failureCode === 'ACCESS_KEY_LOCKED'
          ? new AccessKeyLockedError()
          : new AccessKeyInvalidError();
      }
      // `ReadCommitted`, not `Serializable`: the conversion reads nothing. It writes the `lastAccessedAt` of the
      // link and flips the entry this request appended (by its own id) from `UNLOCK_FAILED` to `UNLOCK`, so
      // there is no read a concurrent writer could invalidate and `Serializable` would only add retries, and
      // `CONFLICT`s, to a visitor who typed the right key. The lockout decision above already ran under the
      // `ShareLink` row lock at `Serializable`.
      await this.uow.run(
        () => this.accessLog.convertToUnlock(attempt.entryId, link.id, this.support.now()),
        { isolation: 'ReadCommitted' },
      );
    }
    const now = this.support.now();
    return {
      documentId: document.documentId,
      unlocked: true,
      unlockCookie: this.support.secrets.signUnlock({
        token: link.token,
        // Each document keeps the expiry it was given: unlocking this one never extends the others.
        grants: [
          ...grantsBefore.filter((grant) => grant.documentId !== document.documentId),
          {
            documentId: document.documentId,
            expiresAt: new Date(now.getTime() + UNLOCK_COOKIE_MAX_AGE_SECONDS * 1000),
          },
        ],
        now,
      }),
    };
  }
}
