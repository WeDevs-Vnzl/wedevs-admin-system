import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CurrentUser as CurrentUserModel } from '../application/current-user';
import { UnauthenticatedError } from '../domain';
import type { AuthenticatedRequest } from './auth.guard';

/** Injects the user the `AuthGuard` resolved. On a route without authentication it is a 401, never `undefined`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserModel => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().currentUser;
    if (!user) throw new UnauthenticatedError();
    return user;
  },
);
