import type { Actor } from '../../../../../shared/application/actor';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, ForbiddenError } from '../../../../../shared/domain/domain-error';
import { isExpiredDocument } from '../../../domain';
import type { DocumentSupport } from '../../document-support';

export interface MarkExpiredDocumentsResult {
  readonly updated: number;
  readonly documentIds: readonly string[];
  /** Documents a `CONFLICT` left for the next run (another transaction held them); the rest was processed. */
  readonly skippedIds: readonly string[];
}

/**
 * Step 2 of `daily-maintenance` (PRD §12, HU-19 CA3, DT-138): every live document except `ANULADO` and
 * `VENCIDO` whose `expiresAt` is before today (Caracas) becomes `VENCIDO`; archived ones are skipped until
 * restored. No route: BE-5 schedules it under a `SYSTEM` actor and anything else is `FORBIDDEN` (DT-130). Each
 * document has its own `Serializable` unit of work that locks it, rechecks the rule on the committed row
 * (a person who archived, voided or edited it meanwhile wins), records `SYSTEM_JOB` with `{ from, to }` and
 * reindexes. A `CONFLICT` skips the document (`skippedIds`, DT-129); any other error aborts the run. A rerun
 * changes nothing.
 */
export class MarkExpiredDocuments {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
  ) {}

  async execute(actor: Actor): Promise<MarkExpiredDocumentsResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const today = this.support.today();
    const updated: string[] = [];
    const skipped: string[] = [];
    for (const id of await this.support.documents.expiredIds(today)) {
      try {
        if (await this.markOne(actor, id, today)) updated.push(id);
      } catch (error) {
        // Only a conflict: a busy document must not abort the rest of the run, the next one picks it up.
        if (!(error instanceof ConflictError)) throw error;
        skipped.push(id);
      }
    }
    return { updated: updated.length, documentIds: updated, skippedIds: skipped };
  }

  private async markOne(actor: Actor, id: string, today: string): Promise<boolean> {
    return this.uow.run(
      async () => {
        await this.support.lock([id]);
        const doc = await this.support.documents.findById(id);
        if (!doc) return false;
        const archived = doc.deletedAt !== null;
        if (!isExpiredDocument({ status: doc.status, expiresAt: doc.expiresAt, archived }, today)) {
          return false;
        }
        await this.support.documents.setStatus(id, {
          status: 'VENCIDO',
          signedAt: doc.signedAt,
          updatedAt: this.support.now(),
          updatedById: null,
        });
        const after = await this.support.documents.findById(id);
        await this.support.reindex(after ?? doc);
        await this.support.record(actor, doc, 'SYSTEM_JOB', {
          metadata: { from: doc.status, to: 'VENCIDO' },
        });
        return true;
      },
      { isolation: 'Serializable' },
    );
  }
}
