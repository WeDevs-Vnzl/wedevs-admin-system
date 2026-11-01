import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { assertMarkdownDocument, assertVersionAllowed } from '../../../domain';
import type { DocumentSupport } from '../../document-support';
import type { DocumentVersionRepository } from '../../ports/document-version.repository.port';
import { assertContentSize } from './version-input';

export interface SaveDraftInput {
  readonly documentId: string;
  readonly content: string;
}

export interface SaveDraftOutput {
  readonly documentId: string;
  readonly draftUpdatedAt: Date;
}

/**
 * `saveDraft` (`PUT /documents/{id}/draft`, PRD §8.9.3, DT-139): the editor's explicit "Save draft". Stores the
 * draft and its time and logs one `UPDATE` marked `{ draft: true }` without the content; it creates no version
 * and no autosave exists. A `FIRMADO` document (or a signed `VENCIDO` one) is `INTEGRITY_LOCK`, a file or link
 * document `CONFLICT`. `Serializable` under the `Document` row lock, so a concurrent `FIRMADO` cannot be missed.
 */
export class SaveDraft {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly versions: DocumentVersionRepository,
  ) {}

  async execute(actor: CurrentUser, input: SaveDraftInput): Promise<SaveDraftOutput> {
    assertCan(this.authorization, actor, 'update', 'document');
    assertContentSize(input.content);

    return this.uow.run(
      async () => {
        await this.support.lock([input.documentId]);
        const doc = await this.support.requireLive(input.documentId);
        assertVersionAllowed(doc);
        const type = await this.support.requireType(doc.typeId);
        assertMarkdownDocument(await this.versions.currentFormat(doc.id), type.defaultFormat);

        const at = this.support.now();
        await this.versions.saveDraft(doc.id, {
          content: input.content,
          at,
          byUserId: actor.userId,
        });
        await this.support.record(actorOf(actor), doc, 'UPDATE', { metadata: { draft: true } });
        return { documentId: doc.id, draftUpdatedAt: at };
      },
      { isolation: 'Serializable' },
    );
  }
}
