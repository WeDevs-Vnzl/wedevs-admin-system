import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import { assertVersionAllowed } from '../../../domain';
import type {
  DocumentDetail,
  DocumentSupport,
  DocumentViews,
  NewVersionInput,
} from '../../document-support';
import { normalizeChangelog } from './version-input';

export type UploadVersionInput = NewVersionInput & { readonly documentId: string };

/**
 * `uploadVersion` (`POST /documents/{id}/versions`): "Subir nueva versión" (a `READY` file) or "Actualizar
 * enlace" (an `http(s)` URL) as the next version, made current. Order inside one `Serializable` unit of work:
 * `Document` row lock → live document → version lock (DT-138) → the file or URL (`File` row lock through
 * `ReserveFileForAttachment`, DT-126 exception 1; a file some version already holds is `CONFLICT`, DT-136) →
 * append. The size and type limits of the file were enforced when it was uploaded (C23, `upload-rules`).
 */
export class UploadVersion {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: UploadVersionInput): Promise<DocumentDetail> {
    assertCan(this.authorization, actor, 'update', 'document');
    const changelog = normalizeChangelog(input.changelog);

    await this.uow.run(
      async () => {
        await this.support.lock([input.documentId]);
        const doc = await this.support.requireLive(input.documentId);
        assertVersionAllowed(doc);
        const content = await this.support.prepareVersion(actor, input);
        await this.support.appendVersion(actor, doc, content, changelog);
      },
      { isolation: 'Serializable' },
    );

    const doc = await this.support.documents.findById(input.documentId);
    if (!doc) throw new NotFoundError();
    return this.views.detail(actor, doc);
  }
}
