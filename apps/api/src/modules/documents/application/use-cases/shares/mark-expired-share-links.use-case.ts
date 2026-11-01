import type { Actor } from '../../../../../shared/application/actor';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { ConflictError, ForbiddenError } from '../../../../../shared/domain/domain-error';
import type { ShareSupport } from './share-support';

export interface MarkExpiredShareLinksResult {
  readonly updated: number;
  readonly shareLinkIds: readonly string[];
  /** Links a `CONFLICT` left for the next run (another transaction held them); the rest was processed. */
  readonly skippedIds: readonly string[];
}

/**
 * Step 5 of `daily-maintenance` (PRD §12, DT-137): every link whose `expiresAt` is before today (Caracas), not
 * revoked and not yet marked gets `expiredAt` and one `SYSTEM_JOB` entry. The mark is only the step's
 * idempotency marker: the portal and every filter decide on the date, never on it. No route: BE-5 schedules it
 * under a `SYSTEM` actor and anything else is `FORBIDDEN` (DT-130). Each link has its own `Serializable` unit of
 * work that locks it and rechecks the rule on the committed row (a person who revoked or renewed it meanwhile
 * wins). A `CONFLICT` skips the link (`skippedIds`, DT-129); any other error aborts the run. A rerun changes
 * nothing, however many days were missed (no time window).
 */
export class MarkExpiredShareLinks {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly support: ShareSupport,
  ) {}

  async execute(actor: Actor): Promise<MarkExpiredShareLinksResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const today = this.support.today();
    const updated: string[] = [];
    const skipped: string[] = [];
    for (const id of await this.support.shares.expiredIds(today)) {
      try {
        if (await this.markOne(actor, id, today)) updated.push(id);
      } catch (error) {
        // Only a conflict: a busy link must not abort the rest of the run, the next one picks it up.
        if (!(error instanceof ConflictError)) throw error;
        skipped.push(id);
      }
    }
    return { updated: updated.length, shareLinkIds: updated, skippedIds: skipped };
  }

  private async markOne(actor: Actor, id: string, today: DateOnly): Promise<boolean> {
    return this.uow.run(
      async () => {
        await this.support.lock(id);
        const link = await this.support.shares.findById(id);
        if (
          !link ||
          link.revokedAt ||
          link.expiredAt ||
          !link.expiresAt ||
          link.expiresAt >= today
        ) {
          return false;
        }
        await this.support.shares.markExpired(id, this.support.now());
        await this.support.record(actor, link, 'SYSTEM_JOB', {
          metadata: { expiresAt: link.expiresAt },
        });
        return true;
      },
      { isolation: 'Serializable' },
    );
  }
}
