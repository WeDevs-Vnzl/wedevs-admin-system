import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ShareAccessLogRetentionPort } from '../application/ports/share-access-log-retention.port';
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
export class PrismaShareAccessLog
  implements ShareAccessLogPort, RateLimitPort, ShareAccessLogRetentionPort
{
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

  /**
   * Retention (DT-74, A9). The cutoff is stated twice, in the candidate subquery and in the `DELETE` itself, so
   * a row that is not strictly older is never deleted whatever the subquery saw. `SKIP LOCKED` leaves a row
   * another transaction is changing for the next run. Lockout reads (`countFailures`) look only at the last
   * minutes, far from the cutoff, and take no lock on these rows.
   */
  async deleteCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    const db = this.host.requireTransaction('ShareAccessLog.deleteCreatedBefore');
    return db.$executeRaw(Prisma.sql`
      DELETE FROM "ShareAccessLog"
      WHERE "createdAt" < ${cutoff}
        AND "id" IN (
          SELECT "id" FROM "ShareAccessLog"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt", "id"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )`);
  }
}
