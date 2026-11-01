import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  writesOf,
  type ShareLinkFieldsInput,
  type ShareLinkMutationResult,
  type ShareSupport,
  type ShareViews,
} from './share-support';

/**
 * `createShareLink` (`POST /share-links`, HU-22 CA1): a link with a CSPRNG token and its documents, each on
 * the latest version or pinned, some with a generated access key. Owner and Admin only (`share`). The keys are
 * generated and hashed before the unit of work opens (A1, scrypt never runs inside one); the clear keys come
 * back once in `generatedKeys` and are stored only as hashes. `Serializable`; records `SHARE_CREATE`.
 */
export class CreateShareLink {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ShareSupport,
    private readonly views: ShareViews,
  ) {}

  async execute(actor: CurrentUser, input: ShareLinkFieldsInput): Promise<ShareLinkMutationResult> {
    assertCan(this.authorization, actor, 'create', 'share');
    const fields = this.support.normalize(input);

    const keyed = fields.documents.filter((item) => item.requiresAccessKey);
    const prepared = await this.support.prepareKeys(keyed.length);
    const keyOf = new Map(
      keyed.flatMap((item, index) => {
        const key = prepared[index];
        return key ? [[item.documentId, key] as const] : [];
      }),
    );

    const id = await this.uow.run(
      async () => {
        await this.support.checkReferences(fields, null);
        const now = this.support.now();
        const link = {
          id: this.support.nextId(),
          token: this.support.newToken(),
          title: fields.title,
          message: fields.message,
          clientId: fields.clientId,
          locale: fields.locale,
          allowDownload: fields.allowDownload,
          expiresAt: fields.expiresAt,
          createdAt: now,
          createdById: actor.userId,
        };
        await this.support.shares.insert(
          link,
          writesOf(fields, (item) => {
            const key = keyOf.get(item.documentId);
            return key ? { kind: 'set', hash: key.hash, updatedAt: now } : { kind: 'clear' };
          }),
        );
        await this.support.record(actorOf(actor), link, 'SHARE_CREATE', {
          metadata: {
            documentCount: fields.documents.length,
            protectedDocumentCount: keyed.length,
          },
        });
        return link.id;
      },
      { isolation: 'Serializable' },
    );

    return {
      share: await this.views.detail(id),
      generatedKeys: keyed.flatMap((item) => {
        const key = keyOf.get(item.documentId);
        return key ? [{ documentId: item.documentId, accessKey: key.accessKey }] : [];
      }),
    };
  }
}
