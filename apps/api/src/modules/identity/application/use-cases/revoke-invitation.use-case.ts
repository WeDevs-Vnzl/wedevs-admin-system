import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import type { IdentityProviderPort } from '../ports/identity-provider.port';

/** `POST /users/invitations/{id}/revoke` (Owner only). An unknown invitation is `NOT_FOUND`. */
export class RevokeInvitation {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly identity: IdentityProviderPort,
    private readonly uow: UnitOfWorkPort,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: { readonly invitationId: string }): Promise<void> {
    assertCan(this.authorization, actor, 'delete', 'user');
    const invitation = await this.identity.revokeInvitation(input.invitationId);
    await this.uow.run(() =>
      this.activity.record({
        actor: actorOf(actor),
        action: 'DELETE',
        entityType: 'USER',
        // `entityId` is the Clerk invitation id, not a local User id: `metadata.invitation: true` marks this entry
        // as non-linkable (there is no User row to open yet).
        entityId: invitation.id,
        entityLabel: invitation.email,
        metadata: { invitation: true },
      }),
    );
  }
}
