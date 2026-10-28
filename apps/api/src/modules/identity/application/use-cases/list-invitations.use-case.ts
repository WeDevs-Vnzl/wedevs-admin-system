import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { IdentityProviderPort, Invitation } from '../ports/identity-provider.port';

/** `GET /users/invitations`: pending invitations read from Clerk (unpaginated, at most 100). */
export class ListInvitations {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly identity: IdentityProviderPort,
  ) {}

  async execute(actor: CurrentUser): Promise<Invitation[]> {
    assertCan(this.authorization, actor, 'read', 'user');
    return this.identity.listPendingInvitations();
  }
}
