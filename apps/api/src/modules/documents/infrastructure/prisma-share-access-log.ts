import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { RateLimitPort, UnlockFailureWindow } from '../application/ports/rate-limit.port';
import type {
  NewShareAccess,
  ShareAccessLogPort,
} from '../application/ports/share-access-log.port';

/**
 * `ShareAccessLog` writer and the lockout counter (C20, DT-45). Both belong to the same table and the same
 * index (`shareLinkId, documentId, ipHash, createdAt`). `createdAt` is always the caller's clock, never the
 * database default, so the 15-minute window follows the application clock.
 *
 * The counters are moved by an atomic `increment` before the insert: the `UPDATE` takes the row lock first,
 * so two simultaneous views queue on it and neither overwrites the other (contract choice 4).
 */
@Injectable()
export class PrismaShareAccessLog implements ShareAccessLogPort, RateLimitPort {
  constructor(private readonly host: TransactionHost) {}

  async append(entry: NewShareAccess): Promise<void> {
    const db = this.host.requireTransaction('ShareAccessLog.append');
    if (entry.event === 'VIEW') {
      await db.shareLink.update({
        where: { id: entry.shareLinkId },
        data: { viewCount: { increment: 1 }, lastAccessedAt: entry.createdAt },
      });
    } else if (entry.event === 'DOWNLOAD') {
      await db.shareLink.update({
        where: { id: entry.shareLinkId },
        data: { downloadCount: { increment: 1 }, lastAccessedAt: entry.createdAt },
      });
    }
    await db.shareAccessLog.create({
      data: {
        id: entry.id,
        shareLinkId: entry.shareLinkId,
        documentId: entry.documentId,
        event: entry.event,
        ipHash: entry.ipHash,
        userAgent: entry.userAgent,
        createdAt: entry.createdAt,
      },
    });
  }

  async convertToUnlock(entryId: string, shareLinkId: string, at: Date): Promise<void> {
    const db = this.host.requireTransaction('ShareAccessLog.convertToUnlock');
    await db.shareLink.update({ where: { id: shareLinkId }, data: { lastAccessedAt: at } });
    await db.shareAccessLog.update({ where: { id: entryId }, data: { event: 'UNLOCK' } });
  }

  countFailures(window: UnlockFailureWindow): Promise<number> {
    return this.host.db.shareAccessLog.count({
      where: {
        shareLinkId: window.shareLinkId,
        documentId: window.documentId,
        ipHash: window.ipHash,
        event: 'UNLOCK_FAILED',
        createdAt: { gt: window.since },
      },
    });
  }
}
