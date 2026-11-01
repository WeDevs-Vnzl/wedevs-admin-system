import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { DocumentStatus } from '../../../../../shared/domain/enums';
import { assertStatusChange } from '../../../domain';
import type { DocumentDetail, DocumentSupport, DocumentViews } from '../../document-support';

export interface SetDocumentStatusInput {
  readonly id: string;
  readonly status: DocumentStatus;
  /** Required for `FIRMADO`, ignored for the other statuses. */
  readonly signedAt?: DateOnly | null;
}

/**
 * `setDocumentStatus` (`POST /documents/{id}/status`, PRD §8.9.4, HU-19 CA1). The transition table, the type's
 * signature capability and the signature date are enforced by `assertStatusChange`; `VENCIDO` is never set by a
 * person (the expiry step sets it). `Serializable` under the `Document` row lock, so a concurrent archive and
 * this change cannot both succeed on a stale read. Logs `STATUS_CHANGE` with the status and signature date.
 */
export class SetDocumentStatus {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: SetDocumentStatusInput): Promise<DocumentDetail> {
    assertCan(this.authorization, actor, 'update', 'document');

    await this.uow.run(
      async () => {
        await this.support.lock([input.id]);
        const doc = await this.support.requireLive(input.id);
        const type = await this.support.requireType(doc.typeId);
        assertStatusChange(doc.status, input.status, type, input.signedAt ?? undefined);

        const signedAt = input.status === 'FIRMADO' ? (input.signedAt ?? null) : doc.signedAt;
        await this.support.documents.setStatus(doc.id, {
          status: input.status,
          signedAt,
          updatedAt: this.support.now(),
          updatedById: actor.userId,
        });
        const after = await this.support.documents.findById(doc.id);
        await this.support.reindex(after ?? doc);
        await this.support.record(actorOf(actor), doc, 'STATUS_CHANGE', {
          changes: diffFields(
            { status: doc.status, signedAt: doc.signedAt },
            { status: input.status, signedAt },
            { fields: ['status', 'signedAt'] },
          ),
        });
      },
      { isolation: 'Serializable' },
    );

    const doc = await this.support.documents.findById(input.id);
    if (!doc) throw new NotFoundError();
    return this.views.detail(actor, doc);
  }
}
