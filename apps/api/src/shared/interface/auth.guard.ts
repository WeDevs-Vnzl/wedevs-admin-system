import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { CurrentUser } from '../application/current-user';
import type { AuthenticatorPort } from '../application/ports/authenticator.port';
import type { AuthorizationPort } from '../application/ports/authorization.port';
import { AUTHENTICATOR, AUTHORIZATION } from '../application/ports/tokens';
import { ForbiddenError, UnauthenticatedError } from '../domain';
import { readRouteGrant } from './grant.decorator';
import { APP_LOGGER, type AppLogger } from './logger';

/** The slice of the HTTP request the guard reads and writes. */
export interface AuthenticatedRequest {
  headers: { authorization?: string | undefined };
  method?: string;
  url?: string;
  currentUser?: CurrentUser;
}

const BEARER = /^Bearer ([^\s]+)$/;

/**
 * Global authentication and coarse authorization guard (C13, C24). Every route must declare exactly one of
 * `@Public()`, `@Authenticated()` or `@RequiresGrant()`; anything else is denied. Registered globally by the
 * app wiring; the use case's own `can()` stays the authority.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTHENTICATOR) private readonly authenticator: AuthenticatorPort,
    @Inject(AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();
    const grant = readRouteGrant(handler, controller);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (grant.kind === 'public') return true;

    if (grant.kind === 'missing' || grant.kind === 'conflict') {
      this.logger.error(
        {
          reason:
            grant.kind === 'missing' ? 'route without grant declaration' : 'conflicting grants',
          controller: controller.name,
          handler: handler.name,
          method: request.method,
          url: request.url,
        },
        'Programming error: route denied (fail-closed)',
      );
      throw new ForbiddenError();
    }

    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthenticatedError();

    const user = await this.authenticator.authenticate(token);
    if (!user) throw new UnauthenticatedError();

    if (grant.kind === 'grant') {
      if (!this.authorization.can(user, grant.action, grant.resource)) throw new ForbiddenError();
    }

    request.currentUser = user;
    return true;
  }
}
