import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttles `POST /mcp` per personal access token (A8) with the existing `THROTTLE_LIMIT` / `THROTTLE_TTL`.
 * The tracker is the SHA-256 of the presented token, so the secret itself is never used as a key or logged.
 * Runs after the global `AuthGuard`, so only a valid token consumes (and fills) a bucket. The 429 it raises
 * becomes `RATE_LIMITED` in the error filter.
 */
@Injectable()
export class McpThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req['headers'] as { authorization?: string } | undefined;
    const token = /^Bearer (\S+)$/.exec(headers?.authorization ?? '')?.[1] ?? '';
    return Promise.resolve(createHash('sha256').update(token).digest('hex'));
  }

  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `mcp-${name}-${tracker}`;
  }
}
