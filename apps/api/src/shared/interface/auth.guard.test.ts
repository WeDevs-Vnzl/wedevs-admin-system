import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FakeAuthenticator } from '../../../test/support/fakes/fake-authenticator';
import { FakeAuthorization } from '../../../test/support/fakes/fake-authorization';
import type { CurrentUser } from '../application/current-user';
import { assertCan } from '../application/ports/authorization.port';
import { actorOf } from '../application/actor';
import { ForbiddenError } from '../domain';
import type { ModuleRef } from '@nestjs/core';
import type { AuthenticatorPort } from '../application/ports/authenticator.port';
import { AuthGuard, McpAuthenticated, type AuthenticatedRequest } from './auth.guard';
import { Authenticated, RequiresGrant } from './grant.decorator';
import type { AppLogger } from './logger';
import { Public } from './public.decorator';

class Routes {
  @Public()
  pub(): void {}
  @Authenticated()
  auth(): void {}
  @RequiresGrant('invoice', 'read')
  grant(): void {}
  undeclared(): void {}
  @Public()
  @Authenticated()
  double(): void {}
}

const USER: CurrentUser = {
  userId: 'usr_1',
  clerkId: 'user_clerk_1',
  role: 'MEMBER',
  email: 'member@example.test',
  name: 'Member',
};

function setup(handlerName: keyof Routes, authorization = new FakeAuthorization()) {
  const authenticator = new FakeAuthenticator();
  const logger: AppLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const guard = new AuthGuard(authenticator, authorization, logger);
  const request: AuthenticatedRequest = { headers: {} };
  const context = {
    getHandler: () => Routes.prototype[handlerName],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, authenticator, authorization, logger, request, context };
}

describe('AuthGuard', () => {
  it('lets a @Public() route through without a token and without an authenticator call', async () => {
    const { guard, context, request } = setup('pub');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUser).toBeUndefined();
  });

  it('missing Authorization header -> 401', async () => {
    const { guard, context } = setup('auth');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it.each(['Basic abc', 'Bearer', 'Bearer ', 'bearer', 'Token abc', 'Bearer a b'])(
    'malformed Authorization %j -> 401',
    async (header) => {
      const { guard, context, request } = setup('auth');
      request.headers.authorization = header;
      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    },
  );

  it('authenticator null -> 401', async () => {
    const { guard, context, request } = setup('auth');
    request.headers.authorization = 'Bearer unknown-token';
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('@Authenticated() with a valid token sets currentUser', async () => {
    const { guard, context, request, authenticator } = setup('auth');
    request.headers.authorization = `Bearer ${authenticator.issue(USER)}`;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUser).toEqual(USER);
  });

  it('undeclared handler -> 403, fail-closed and logged', async () => {
    const { guard, context, request, authenticator, logger } = setup('undeclared');
    request.headers.authorization = `Bearer ${authenticator.issue(USER)}`;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(request.currentUser).toBeUndefined();
  });

  it('double-declared handler -> 403, fail-closed and logged', async () => {
    const { guard, context, logger } = setup('double');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('@RequiresGrant denied -> 403 and currentUser stays unset', async () => {
    const authorization = new FakeAuthorization({ policy: () => false });
    const { guard, context, request, authenticator } = setup('grant', authorization);
    request.headers.authorization = `Bearer ${authenticator.issue(USER)}`;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(request.currentUser).toBeUndefined();
  });

  it('@RequiresGrant allowed -> passes the declared resource/action and sets currentUser', async () => {
    const calls: unknown[][] = [];
    const authorization = new FakeAuthorization({
      policy: (...args) => {
        calls.push(args);
        return true;
      },
    });
    const { guard, context, request, authenticator } = setup('grant', authorization);
    request.headers.authorization = `Bearer ${authenticator.issue(USER)}`;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(calls).toEqual([[USER, 'read', 'invoice', undefined]]);
    expect(request.currentUser).toEqual(USER);
  });
});

class McpRoutes {
  @McpAuthenticated()
  mcp(): void {}
}

const PAT = `wdc_pat_${'A'.repeat(43)}`;

function setupMcp(options: { mcp?: AuthenticatorPort | null; route?: 'mcp' | 'auth' } = {}) {
  const clerk = new FakeAuthenticator();
  const clerkSpy = vi.spyOn(clerk, 'authenticate');
  const mcp: AuthenticatorPort | null =
    options.mcp === undefined ? { authenticate: vi.fn(() => Promise.resolve(USER)) } : options.mcp;
  const moduleRef = {
    get: vi.fn(() => {
      if (!mcp) throw new Error('not found');
      return mcp;
    }),
  } as unknown as ModuleRef;
  const logger: AppLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const guard = new AuthGuard(clerk, new FakeAuthorization(), logger, moduleRef);
  const request: AuthenticatedRequest = { headers: {} };
  const onMcp = (options.route ?? 'mcp') === 'mcp';
  const context = {
    getHandler: () => (onMcp ? McpRoutes.prototype.mcp : Routes.prototype.auth),
    getClass: () => (onMcp ? McpRoutes : Routes),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, clerk, clerkSpy, mcp, request, context };
}

describe('AuthGuard, second authenticator on the MCP route only (DT-190)', () => {
  it('a personal access token on the MCP route is resolved by the MCP authenticator alone', async () => {
    const { guard, context, request, clerkSpy, mcp } = setupMcp();
    request.headers.authorization = `Bearer ${PAT}`;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUser).toEqual(USER);
    expect(mcp?.authenticate).toHaveBeenCalledWith(PAT);
    expect(clerkSpy).not.toHaveBeenCalled();
  });

  it('a Clerk JWT on the MCP route is 401 and never reaches either authenticator', async () => {
    const { guard, context, request, clerk, clerkSpy, mcp } = setupMcp();
    request.headers.authorization = `Bearer ${clerk.issue(USER)}`;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(clerkSpy).not.toHaveBeenCalled();
    expect(mcp?.authenticate).not.toHaveBeenCalled();
  });

  it('a personal access token on any other route is 401 without asking the Clerk authenticator', async () => {
    const { guard, context, request, clerkSpy, mcp } = setupMcp({ route: 'auth' });
    request.headers.authorization = `Bearer ${PAT}`;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(clerkSpy).not.toHaveBeenCalled();
    expect(mcp?.authenticate).not.toHaveBeenCalled();
  });

  it('a Clerk JWT on an ordinary route still works with the MCP authenticator bound', async () => {
    const { guard, context, request, clerk } = setupMcp({ route: 'auth' });
    request.headers.authorization = `Bearer ${clerk.issue(USER)}`;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUser).toEqual(USER);
  });

  it('the MCP route is 401 when the authenticator answers null', async () => {
    const { guard, context, request } = setupMcp({
      mcp: { authenticate: vi.fn(() => Promise.resolve(null)) },
    });
    request.headers.authorization = `Bearer ${PAT}`;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(request.currentUser).toBeUndefined();
  });

  it('the MCP route fails closed (401) when no MCP authenticator is bound', async () => {
    const { guard, context, request } = setupMcp({ mcp: null });
    request.headers.authorization = `Bearer ${PAT}`;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('the MCP route without a Bearer header is 401', async () => {
    const { guard, context } = setupMcp();
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('assertCan / actorOf', () => {
  it('assertCan throws ForbiddenError when the port denies', () => {
    expect(() =>
      assertCan(new FakeAuthorization({ policy: () => false }), USER, 'read', 'invoice'),
    ).toThrow(ForbiddenError);
  });

  it('assertCan passes opts through and returns when allowed', () => {
    const seen: unknown[] = [];
    const port = new FakeAuthorization({
      policy: (_user, _action, _resource, opts) => {
        seen.push(opts);
        return true;
      },
    });
    expect(() => assertCan(port, USER, 'delete', 'note', { ownerId: 'usr_1' })).not.toThrow();
    expect(seen).toEqual([{ ownerId: 'usr_1' }]);
  });

  it('actorOf maps a current user to a USER actor', () => {
    expect(actorOf(USER)).toEqual({ actorType: 'USER', userId: 'usr_1' });
  });
});
