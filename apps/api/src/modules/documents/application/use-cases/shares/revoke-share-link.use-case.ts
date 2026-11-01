import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { IntegrityLockedError } from '../../../../../shared/domain/domain-error';
import type { ShareLinkDetail, ShareSupport, ShareViews } from './share-support';

/**
 * `revokeShareLink` (`POST /share-links/{id}/revoke`): sets `revokedAt`; the portal then answers the generic
 * 404. Final: a revoked link is `INTEGRITY_LOCK` for every later edit and for a second revoke. `Serializable`
 * under the `ShareLink` row lock; records `SHARE_REVOKE`.
 */
export class RevokeShareLink {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ShareSupport,
    private readonly views: ShareViews,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<ShareLinkDetail> {
    assertCan(this.authorization, actor, 'update', 'share');
    await this.uow.run(
      async () => {
        await this.support.lock(input.id);
        const link = await this.support.requireLink(input.id);
        if (link.revokedAt) throw new IntegrityLockedError();
        await this.support.shares.revoke(link.id, this.support.now());
        await this.support.record(actorOf(actor), link, 'SHARE_REVOKE');
      },
      { isolation: 'Serializable' },
    );
    return this.views.detail(input.id);
  }
}
