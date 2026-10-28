import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import type { UserRole } from '../../../../shared/domain/enums';
import { USER_ERROR_KEYS, normalizeEmail, parseUserRole } from '../../domain/user';
import type { DiagnosticsPort } from '../ports/diagnostics.port';
import type { IdentityProviderPort, Invitation } from '../ports/identity-provider.port';
import type { UserRepository } from '../ports/user.repository.port';

export interface InviteUserInput {
  readonly email: string;
  readonly role: UserRole;
}

/**
 * `POST /users/invitations` (Owner only). Invitation only (HU-01): the role travels in the invitation's
 * public metadata and the webhook applies it when the person signs up. If recording the activity fails the
 * invitation is revoked, so Clerk and the log never disagree.
 */
export class InviteUser {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly users: UserRepository,
    private readonly identity: IdentityProviderPort,
    private readonly uow: UnitOfWorkPort,
    private readonly activity: ActivityLogPort,
    private readonly diagnostics: DiagnosticsPort,
  ) {}

  async execute(actor: CurrentUser, input: InviteUserInput): Promise<Invitation> {
    assertCan(this.authorization, actor, 'create', 'user');
    const role = parseUserRole(input.role);
    if (!role)
      throw new ValidationFailedError({ fieldErrors: { role: ['validation.invalidOption'] } });
    const email = normalizeEmail(input.email);

    if (await this.users.findActiveByEmail(email)) {
      throw new ConflictError({ fieldErrors: { email: [USER_ERROR_KEYS.emailTaken] } });
    }

    const invitation = await this.identity.createInvitation(email, role);
    try {
      await this.uow.run(() =>
        this.activity.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'USER',
          // `entityId` is the Clerk invitation id, not a local User id: `metadata.invitation: true` marks this entry
          // as non-linkable (there is no User row to open yet).
          entityId: invitation.id,
          entityLabel: email,
          metadata: { invitation: true, role },
        }),
      );
    } catch (error) {
      try {
        await this.identity.revokeInvitation(invitation.id);
      } catch {
        this.diagnostics.warn('Could not revoke the invitation after a failed activity write', {
          invitationId: invitation.id,
        });
      }
      throw error;
    }
    return invitation;
  }
}
