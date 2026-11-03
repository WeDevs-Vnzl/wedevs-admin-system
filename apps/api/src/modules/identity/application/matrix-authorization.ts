import type {
  PermissionAction,
  PermissionOptions,
  PermissionResource,
} from '../../../shared/application/authorization';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../shared/application/ports/authorization.port';
import { can, canSeeFinancials } from '../domain/permission-matrix';

/** The PRD §4.3 matrix behind `AuthorizationPort`. Pure: no I/O, the role comes from the DB-backed user (C13). */
export class MatrixAuthorization implements AuthorizationPort {
  can(
    user: CurrentUser,
    action: PermissionAction,
    resource: PermissionResource,
    opts?: PermissionOptions,
  ): boolean {
    return can(user, action, resource, opts);
  }

  canSeeFinancials(user: CurrentUser): boolean {
    return canSeeFinancials(user);
  }
}
