import { ForbiddenError } from '../../domain/domain-error';
import type { PermissionAction, PermissionOptions, PermissionResource } from '../authorization';
import type { CurrentUser } from '../current-user';

/** The permission matrix of PRD §4.3 behind a port. Anything not granted is denied (C13). */
export interface AuthorizationPort {
  can(
    user: CurrentUser,
    action: PermissionAction,
    resource: PermissionResource,
    opts?: PermissionOptions,
  ): boolean;
  /** Whether the user may see money amounts and financial aggregates. */
  canSeeFinancials(user: CurrentUser): boolean;
}

/** First line of every use case: throws `ForbiddenError` when the matrix denies the action. */
export function assertCan(
  port: AuthorizationPort,
  user: CurrentUser,
  action: PermissionAction,
  resource: PermissionResource,
  opts?: PermissionOptions,
): void {
  if (!port.can(user, action, resource, opts)) throw new ForbiddenError();
}
