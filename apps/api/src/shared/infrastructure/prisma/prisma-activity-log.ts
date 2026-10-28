import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma } from './generated-client';
import type { ActivityEntry, ActivityLogPort } from '../../application/ports/activity-log.port';
import type { ClientMetricsWriterPort } from '../../application/ports/client-metrics-writer.port';
import type { RequestContextPort } from '../../application/ports/request-context.port';
import { CLIENT_METRICS_WRITER, REQUEST_CONTEXT } from '../../application/ports/tokens';
import { PrismaClientMetricsWriter } from './prisma-client-metrics-writer';
import { TransactionHost } from './transaction-host';

const json = (value: Readonly<Record<string, unknown>> | null | undefined) =>
  value ? (value as Prisma.InputJsonObject) : undefined;

/**
 * Inserts the `ActivityLog` row in the current transaction (C12). Append-only by construction: the class
 * exposes no update or delete (C20). For `USER` entries it fills `ip`/`userAgent` from the request
 * context when the entry leaves them unset, and it bumps `ClientMetrics.lastActivityAt` of the entry's
 * client(s) in the same transaction (Δ12, Q-BE2-2).
 */
@Injectable()
export class PrismaActivityLog implements ActivityLogPort {
  private readonly metrics: ClientMetricsWriterPort;

  constructor(
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Optional() @Inject(CLIENT_METRICS_WRITER) metrics?: ClientMetricsWriterPort,
    @Optional() @Inject(REQUEST_CONTEXT) private readonly requestContext?: RequestContextPort,
  ) {
    this.metrics = metrics ?? new PrismaClientMetricsWriter(host);
  }

  async record(entry: ActivityEntry): Promise<void> {
    const tx = this.host.requireTransaction('ActivityLogPort.record');
    const request = entry.actor.actorType === 'USER' ? this.requestContext?.current() : null;
    const row = await tx.activityLog.create({
      data: {
        actorType: entry.actor.actorType,
        actorId: entry.actor.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityLabel: entry.entityLabel,
        clientId: entry.clientId ?? null,
        changes: json(entry.changes),
        metadata: json(entry.metadata),
        ip: entry.ip ?? request?.ip ?? null,
        userAgent: entry.userAgent ?? request?.userAgent ?? null,
      },
      select: { createdAt: true },
    });
    const touched = [...(entry.touchClientIds ?? []), ...(entry.clientId ? [entry.clientId] : [])];
    if (touched.length > 0) await this.metrics.touchActivity(touched, row.createdAt);
  }
}
