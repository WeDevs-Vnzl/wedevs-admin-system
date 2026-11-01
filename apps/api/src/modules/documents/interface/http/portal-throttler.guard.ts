import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * The throttler of the public portal (DT-88): `THROTTLE_LIMIT` requests per `THROTTLE_TTL` seconds per visitor
 * IP, applied with `@UseGuards` on the portal controller only, so no other route is affected. The tracker is
 * `req.ip`, which follows `TRUST_PROXY_HOPS` (DT-143). The 429 it raises becomes `RATE_LIMITED` in the error
 * filter, and carries the C22 headers because their middleware runs first.
 */
@Injectable()
export class PortalThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = req['ip'];
    return Promise.resolve(typeof ip === 'string' && ip !== '' ? ip : 'unknown');
  }
}
