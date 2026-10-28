import { Injectable } from '@nestjs/common';
import type { ClientMetricsWriterPort } from '../../application/ports/client-metrics-writer.port';
import { TransactionHost } from './transaction-host';

/**
 * Writes `projectCount` and `lastActivityAt` of `ClientMetrics` (DT-111) in the current transaction.
 * Never touches the money columns, which keep their database defaults until BE-3's projector fills them.
 */
@Injectable()
export class PrismaClientMetricsWriter implements ClientMetricsWriterPort {
  constructor(private readonly host: TransactionHost) {}

  async ensure(clientId: string): Promise<void> {
    const tx = this.host.requireTransaction('ClientMetricsWriterPort.ensure');
    await tx.clientMetrics.upsert({ where: { clientId }, create: { clientId }, update: {} });
  }

  async setProjectCount(clientId: string, count: number): Promise<void> {
    const tx = this.host.requireTransaction('ClientMetricsWriterPort.setProjectCount');
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid projectCount: ${count}`);
    await tx.clientMetrics.upsert({
      where: { clientId },
      create: { clientId, projectCount: count },
      update: { projectCount: count },
    });
  }

  async touchActivity(clientIds: readonly string[], at: Date): Promise<void> {
    const tx = this.host.requireTransaction('ClientMetricsWriterPort.touchActivity');
    const ids = [...new Set(clientIds)];
    if (ids.length === 0) return;
    // INSERT ... SELECT from "Client" so an id that does not exist is skipped instead of failing the
    // transaction on the foreign key; GREATEST ignores NULL, so the first touch sets the value.
    await tx.$executeRaw`
      INSERT INTO "ClientMetrics" ("clientId", "lastActivityAt", "updatedAt")
      SELECT c."id", ${at}, now() FROM "Client" c WHERE c."id" = ANY(${ids}::text[])
      ON CONFLICT ("clientId") DO UPDATE SET
        "lastActivityAt" = GREATEST("ClientMetrics"."lastActivityAt", EXCLUDED."lastActivityAt"),
        "updatedAt" = now()`;
  }
}
