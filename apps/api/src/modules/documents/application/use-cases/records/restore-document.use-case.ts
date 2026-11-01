import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import type { DocumentSupport } from '../../document-support';

/**
 * Restores an archived document (`POST /documents/{id}/restore` and the trash handler). `can(restore, document)`
 * needs the trash grant (Owner, Admin). An unknown or live document is `NOT_FOUND`. The code is unique by the
 * sequence and nothing else can collide, so there is no conflict check (PRD §7.7). Records `RESTORE` and
 * reindexes; the expiry step catches a restored document that expired meanwhile on its next run.
 */
export class RestoreDocument {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<EntityRef> {
    assertCan(this.authorization, actor, 'restore', 'document');

    return this.uow.run(
      async () => {
        await this.support.lock([input.id]);
        const doc = await this.support.documents.findById(input.id);
        if (!doc || !doc.deletedAt) throw new NotFoundError();

        await this.support.documents.restore(doc.id, this.support.now(), actor.userId);
        const restored = await this.support.documents.findById(doc.id);
        await this.support.reindex(restored ?? { ...doc, deletedAt: null });
        await this.support.record(actorOf(actor), doc, 'RESTORE');
        return { type: 'DOCUMENT' as const, id: doc.id, code: doc.code, label: doc.title };
      },
      { isolation: 'Serializable' },
    );
  }
}
