import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { SHARE_DOWNLOAD_TTL_SECONDS } from '../../../domain';
import type { IssueFileDeliveryUrl } from '../../../../platform/application/use-cases/issue-file-delivery-url.use-case';
import type { DocumentVersionRepository } from '../../ports/document-version.repository.port';
import { isHttpUrl, type PortalSupport, type PortalVisitor } from './portal-support';

export type PortalDisposition = 'inline' | 'attachment';

export interface GetSharedDocumentDeliveryInput {
  readonly token: string;
  readonly documentId: string;
  readonly disposition: PortalDisposition;
  readonly visitor: PortalVisitor;
}

/** What the file route answers: a 302 to a URL, or the markdown body (contract choice 9). */
export type PortalDelivery =
  | { readonly kind: 'redirect'; readonly url: string }
  | {
      readonly kind: 'markdown';
      readonly body: string;
      /** `<code>-v<n>.md`. */
      readonly fileName: string;
      readonly attachment: boolean;
    };

/**
 * `getSharedDocumentDelivery` (PRD §8.11 "Descargas", contract choices 8 and 9): a file as a signed URL that
 * lives `SHARE_DOWNLOAD_TTL_SECONDS` (5 minutes) generated per call through `IssueFileDeliveryUrl`, a link as a
 * redirect to its stored `http(s)` URL, markdown as a `.md` body. `DOWNLOAD` is logged only for `attachment`,
 * after the delivery was built; `allowDownload = false` refuses `attachment` and still allows `inline`.
 */
export class GetSharedDocumentDelivery {
  constructor(
    private readonly support: PortalSupport,
    private readonly versions: DocumentVersionRepository,
    private readonly files: Pick<IssueFileDeliveryUrl, 'execute'>,
  ) {}

  async execute(input: GetSharedDocumentDeliveryInput): Promise<PortalDelivery> {
    const link = await this.support.liveLink(input.token);
    const row = await this.support.sharedDocument(link, input.documentId);
    const attachment = input.disposition === 'attachment';
    const unlocked = this.support.unlockedIds(input.visitor, link.token);
    if (this.support.isLocked(row, unlocked)) throw new ForbiddenError();
    if (attachment && !link.allowDownload) throw new ForbiddenError();

    const version = await this.versions.findInDocument(row.documentId, row.version.id);
    if (!version) throw new NotFoundError();

    let delivery: PortalDelivery;
    if (version.format === 'MARKDOWN') {
      delivery = {
        kind: 'markdown',
        body: version.content ?? '',
        fileName: `${row.code}-v${version.versionNumber}.md`,
        attachment,
      };
    } else if (version.format === 'ENLACE') {
      if (!version.url || !isHttpUrl(version.url)) throw new NotFoundError();
      delivery = { kind: 'redirect', url: version.url };
    } else {
      if (!version.file) throw new NotFoundError();
      const signed = await this.files.execute(version.file.id, {
        disposition: input.disposition,
        ttlMs: SHARE_DOWNLOAD_TTL_SECONDS * 1000,
      });
      delivery = { kind: 'redirect', url: signed.url };
    }
    if (attachment) await this.support.logAccess(link, 'DOWNLOAD', row.documentId, input.visitor);
    return delivery;
  }
}
