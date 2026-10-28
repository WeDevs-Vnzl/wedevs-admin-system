import type {
  PermissionAction,
  PermissionOptions,
  PermissionResource,
} from '../../../src/shared/application/authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { AuthorizationPort } from '../../../src/shared/application/ports/authorization.port';

export type FakePolicy = (
  user: CurrentUser,
  action: PermissionAction,
  resource: PermissionResource,
  opts: PermissionOptions | undefined,
) => boolean;

export interface FakeAuthorizationOptions {
  /** Defaults to allow-all. */
  readonly policy?: FakePolicy;
  /** Defaults to Owner and Admin. */
  readonly canSeeFinancials?: (user: CurrentUser) => boolean;
}

/** Configurable stand-in for the real matrix (package 2.1). */
export class FakeAuthorization implements AuthorizationPort {
  private policy: FakePolicy;
  private financials: (user: CurrentUser) => boolean;

  constructor(options: FakeAuthorizationOptions = {}) {
    this.policy = options.policy ?? (() => true);
    this.financials =
      options.canSeeFinancials ?? ((user) => ['OWNER', 'ADMIN'].includes(user.role));
  }

  setPolicy(policy: FakePolicy): void {
    this.policy = policy;
  }

  can(
    user: CurrentUser,
    action: PermissionAction,
    resource: PermissionResource,
    opts?: PermissionOptions,
  ): boolean {
    return this.policy(user, action, resource, opts);
  }

  canSeeFinancials(user: CurrentUser): boolean {
    return this.financials(user);
  }
}
