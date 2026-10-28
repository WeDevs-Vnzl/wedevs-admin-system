import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request } from 'express';
import type { RequestContextPort } from '../application/ports/request-context.port';
import { REQUEST_CONTEXT } from '../application/ports/tokens';

export const USER_AGENT_MAX_LENGTH = 512;

/**
 * Runs the rest of the request inside `RequestContextPort.run({ ip, userAgent })` so the activity writer
 * can stamp `USER` entries (Q-BE2-5). `ip` is `req.ip` as Express resolves it with the app's trust-proxy
 * setting; the user agent is truncated to 512 characters.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(REQUEST_CONTEXT) private readonly context: RequestContextPort) {}

  use(req: Request, _res: unknown, next: NextFunction): void {
    const ua = req.header('user-agent');
    const userAgent =
      typeof ua === 'string' && ua.length > 0 ? ua.slice(0, USER_AGENT_MAX_LENGTH) : null;
    const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
    this.context.run({ ip, userAgent }, () => next());
  }
}
