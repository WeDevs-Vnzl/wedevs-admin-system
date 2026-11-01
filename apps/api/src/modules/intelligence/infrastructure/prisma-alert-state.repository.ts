import { Injectable } from '@nestjs/common';
import type { IdGeneratorPort } from '../../../shared/application/ports/id-generator.port';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  AlertStateRecord,
  AlertStateRepository,
} from '../application/ports/alert-state.repository.port';
import type { AlertHiding } from '../domain/alert-state';

/**
 * `AlertState` over single-statement upserts on `(userId, alertKey)` (`INSERT ... ON CONFLICT DO UPDATE`).
 * One statement is atomic under any isolation, so two writers of one key leave one row and a read mark never
 * overwrites a dismissal (each statement touches only its own columns). Own rows only; no activity (DT-79).
 */
@Injectable()
export class PrismaAlertStateRepository implements AlertStateRepository {
  constructor(
    private readonly tx: TransactionHost,
    private readonly ids: IdGeneratorPort,
  ) {}

  async listByUser(userId: string, alertKeys: readonly string[]): Promise<AlertStateRecord[]> {
    if (alertKeys.length === 0) return [];
    const rows = await this.tx.db.alertState.findMany({
      where: { userId, alertKey: { in: [...alertKeys] } },
      select: { alertKey: true, readAt: true, dismissedAt: true, dismissedUntil: true },
    });
    return rows;
  }

  async markRead(userId: string, alertKeys: readonly string[], at: Date): Promise<void> {
    // Sorted so concurrent batches take their index locks in the same order.
    const keys = [...new Set(alertKeys)].sort();
    if (keys.length === 0) return;
    const ids = keys.map(() => this.ids.next());
    await this.tx.db.$executeRaw(Prisma.sql`
      INSERT INTO "AlertState" ("id", "userId", "alertKey", "readAt", "createdAt")
      SELECT i, ${userId}, k, ${at}, ${at}
      FROM unnest(${ids}::text[], ${keys}::text[]) AS t(i, k)
      ON CONFLICT ("userId", "alertKey")
      DO UPDATE SET "readAt" = COALESCE("AlertState"."readAt", EXCLUDED."readAt")`);
  }

  async hide(userId: string, alertKey: string, hiding: AlertHiding, at: Date): Promise<void> {
    await this.tx.db.$executeRaw(Prisma.sql`
      INSERT INTO "AlertState" ("id", "userId", "alertKey", "dismissedAt", "dismissedUntil", "createdAt")
      VALUES (${this.ids.next()}, ${userId}, ${alertKey}, ${hiding.dismissedAt}, ${hiding.dismissedUntil}, ${at})
      ON CONFLICT ("userId", "alertKey")
      DO UPDATE SET "dismissedAt" = EXCLUDED."dismissedAt", "dismissedUntil" = EXCLUDED."dismissedUntil"`);
  }

  async clearHiding(userId: string, alertKey: string): Promise<void> {
    await this.tx.db.alertState.updateMany({
      where: { userId, alertKey },
      data: { dismissedAt: null, dismissedUntil: null },
    });
  }
}
