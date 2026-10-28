import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../shared/domain/activity-diff';
import {
  IntegrityLockedError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../shared/domain/domain-error';
import type { UserRole } from '../../../../shared/domain/enums';
import {
  USER_DIFF_FIELDS,
  USER_ERROR_KEYS,
  parseUserRole,
  wouldRemoveLastOwner,
} from '../../domain/user';
import { toUserDetail, type UserDetailOutput } from '../models';
import type { DiagnosticsPort } from '../ports/diagnostics.port';
import type { IdentityProviderPort } from '../ports/identity-provider.port';
import type { UserRepository } from '../ports/user.repository.port';

export interface ChangeUserRoleInput {
  readonly userId: string;
  readonly role: UserRole;
}

/**
 * `PATCH /users/{id}` (Owner only). The last-Owner check and the change run in one `Serializable` unit of
 * work, so two concurrent demotions cannot both pass (C18). The Clerk metadata is mirrored after commit,
 * best effort: the DB stays the source (PRD §4.2).
 */
export class ChangeUserRole {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly users: UserRepository,
    private readonly uow: UnitOfWorkPort,
    private readonly activity: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly identity: IdentityProviderPort,
    private readonly diagnostics: DiagnosticsPort,
  ) {}

  async execute(actor: CurrentUser, input: ChangeUserRoleInput): Promise<UserDetailOutput> {
    assertCan(this.authorization, actor, 'update', 'user');
    const role = parseUserRole(input.role);
    if (!role)
      throw new ValidationFailedError({ fieldErrors: { role: ['validation.invalidOption'] } });

    const { user, changed } = await this.uow.run(
      async () => {
        const current = await this.users.findActiveById(input.userId);
        if (!current) throw new NotFoundError();
        const owners = await this.users.countActiveOwners();
        if (wouldRemoveLastOwner(current, role, owners)) {
          throw new IntegrityLockedError({ message: USER_ERROR_KEYS.lastOwner });
        }
        const changes = diffFields({ role: current.role }, { role }, { fields: USER_DIFF_FIELDS });
        if (!changes) return { user: current, changed: false };
        const updated = await this.users.updateRole(current.id, role, this.clock.now());
        await this.activity.record({
          actor: actorOf(actor),
          action: 'UPDATE',
          entityType: 'USER',
          entityId: current.id,
          entityLabel: current.name,
          changes,
        });
        return { user: updated, changed: true };
      },
      { isolation: 'Serializable' },
    );

    if (changed) {
      try {
        await this.identity.setRoleMetadata(user.clerkId, user.role);
      } catch (error) {
        this.diagnostics.warn('Could not mirror the role to the identity provider', {
          userId: user.id,
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    return toUserDetail(user);
  }
}
