import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** The C22 headers of every portal response (the FE `PORTAL_SECURITY_HEADERS`). */
export const PORTAL_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
} as const;

/**
 * Sets the C22 headers before any guard runs, so 404, 401, 403, 429 and 302 carry them as much as a 200 (PRD
 * §8.11 "Cabeceras"). Middleware runs ahead of guards, pipes and the error filter, which only adds to them.
 */
@Injectable()
export class PortalHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    for (const [name, value] of Object.entries(PORTAL_HEADERS)) res.setHeader(name, value);
    next();
  }
}
