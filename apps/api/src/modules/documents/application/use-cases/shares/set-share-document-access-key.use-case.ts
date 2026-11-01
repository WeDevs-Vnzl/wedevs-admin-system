import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  ConflictError,
  IntegrityLockedError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../../shared/domain/domain-error';
import type { ShareLinkRecord } from '../../ports/share-link.repository.port';
import type { PreparedKey, ShareSupport } from './share-support';

export const ACCESS_KEY_ACTION_VALUES = ['generate', 'regenerate', 'remove'] as const;
export type AccessKeyAction = (typeof ACCESS_KEY_ACTION_VALUES)[number];

export interface SetShareDocumentAccessKeyInput {
  readonly shareLinkId: string;
  readonly documentId: string;
  readonly action: AccessKeyAction;
}

export interface SetShareDocumentAccessKeyResult {
  readonly shareLinkId: string;
  readonly documentId: string;
  readonly action: AccessKeyAction;
  readonly requiresAccessKey: boolean;
  readonly accessKeyUpdatedAt: Date | null;
  /** The clear key: non-null only for `generate` and `regenerate`, and only in this result. */
  readonly accessKey: string | null;
}

/**
 * `setShareDocumentAccessKey` (`POST /share-links/{id}/documents/{documentId}/access-key`): `generate` needs a
 * document without a key, `regenerate` and `remove` one with a key; any other combination is `CONFLICT` (a stale
 * UI), so a key is never replaced or shown by accident. A document outside the link is `NOT_FOUND`, a revoked
 * link `INTEGRITY_LOCK`. A regenerated key does not revoke an unlock cookie already issued (A4). The key is
 * hashed before the unit of work opens (A1); inside it the row lock and a recheck decide, so two `generate`
 * calls on one document leave one key and one `CONFLICT`. Records `UPDATE` with `accessKey: "changed"` only.
 */
export class SetShareDocumentAccessKey {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ShareSupport,
  ) {}

  async execute(
    actor: CurrentUser,
    input: SetShareDocumentAccessKeyInput,
  ): Promise<SetShareDocumentAccessKeyResult> {
    assertCan(this.authorization, actor, 'update', 'share');
    if (!(ACCESS_KEY_ACTION_VALUES as readonly string[]).includes(input.action)) {
      throw new ValidationFailedError({ fieldErrors: { action: ['validation.invalidOption'] } });
    }

    // Fail fast on the stale-UI cases before paying for scrypt; the locked recheck below decides.
    await this.check(input);
    const key: PreparedKey | null =
      input.action === 'remove' ? null : ((await this.support.prepareKeys(1))[0] ?? null);

    const updatedAt = await this.uow.run(
      async () => {
        await this.support.lock(input.shareLinkId);
        const link = await this.check(input);
        const now = this.support.now();
        await this.support.shares.setKey(
          input.shareLinkId,
          input.documentId,
          key ? { hash: key.hash, updatedAt: now } : null,
        );
        await this.support.record(actorOf(actor), link, 'UPDATE', {
          changes: { accessKey: 'changed' },
          metadata: { documentId: input.documentId, accessKeyAction: input.action },
        });
        return key ? now : null;
      },
      { isolation: 'Serializable' },
    );

    return {
      shareLinkId: input.shareLinkId,
      documentId: input.documentId,
      action: input.action,
      requiresAccessKey: key !== null,
      accessKeyUpdatedAt: updatedAt,
      accessKey: key?.accessKey ?? null,
    };
  }

  private async check(input: SetShareDocumentAccessKeyInput): Promise<ShareLinkRecord> {
    const link = await this.support.requireLink(input.shareLinkId);
    const row = (await this.support.shares.documentsOf(link.id)).find(
      (item) => item.documentId === input.documentId,
    );
    if (!row) throw new NotFoundError();
    if (link.revokedAt) throw new IntegrityLockedError();
    if ((input.action === 'generate') === row.hasAccessKey) throw new ConflictError();
    return link;
  }
}
