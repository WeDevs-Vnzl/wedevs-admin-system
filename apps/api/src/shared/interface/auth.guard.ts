import {
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { CurrentUser } from '../application/current-user';
import type { AuthenticatorPort } from '../application/ports/authenticator.port';
import type { AuthorizationPort } from '../application/ports/authorization.port';
import { AUTHENTICATOR, AUTHORIZATION, MCP_AUTHENTICATOR } from '../application/ports/tokens';
import { ForbiddenError, UnauthenticatedError } from '../domain';
import { Authenticated, readRouteGrant } from './grant.decorator';
import { APP_LOGGER, type AppLogger } from './logger';

/** The slice of the HTTP request the guard reads and writes. */
export interface AuthenticatedRequest {
  headers: { authorization?: string | undefined };
  method?: string;
  url?: string;
  currentUser?: CurrentUser;
}

const BEARER = /^Bearer ([^\s]+)$/;
/** Prefix of a personal access token (A9). Such a token is valid only on the MCP route (DT-190). */
const API_TOKEN_PREFIX = 'wdc_pat_';
const USES_MCP_AUTHENTICATOR_KEY = 'usesMcpAuthenticator';

/**
 * Marks the one route authenticated by a personal access token (`POST /mcp`, DT-190) instead of a Clerk
 * JWT. It is an `@Authenticated()` route: the tool's own grant and the use case's `can()` decide the rest.
 */
export const McpAuthenticated = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Authenticated(), SetMetadata(USES_MCP_AUTHENTICATOR_KEY, true));

function usesMcpAuthenticator(handler: object, controller: object): boolean {
  return (
    (Reflect.getMetadata(USES_MCP_AUTHENTICATOR_KEY, handler) as boolean | undefined) === true ||
    (Reflect.getMetadata(USES_MCP_AUTHENTICATOR_KEY, controller) as boolean | undefined) === true
  );
}

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
    @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * The second authenticator is bound by the token module, which is not global, so it is looked up in the
   * whole container on first use. Not bound means the MCP route cannot authenticate anyone (fail closed).
   */
  private mcpAuthenticator(): AuthenticatorPort | null {
    try {
      return this.moduleRef?.get<AuthenticatorPort>(MCP_AUTHENTICATOR, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }

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

    const isApiToken = token.startsWith(API_TOKEN_PREFIX);
    let user: CurrentUser | null = null;
    if (usesMcpAuthenticator(handler, controller)) {
      // A Clerk JWT here is 401, and so is anything when the second authenticator is not bound.
      if (isApiToken) user = (await this.mcpAuthenticator()?.authenticate(token)) ?? null;
    } else if (!isApiToken) {
      // A personal access token on any other route is 401 and never reaches the Clerk authenticator.
      user = await this.authenticator.authenticate(token);
    }
    if (!user) throw new UnauthenticatedError();

    if (grant.kind === 'grant') {
      if (!this.authorization.can(user, grant.action, grant.resource)) throw new ForbiddenError();
    }

    request.currentUser = user;
    return true;
  }
}
