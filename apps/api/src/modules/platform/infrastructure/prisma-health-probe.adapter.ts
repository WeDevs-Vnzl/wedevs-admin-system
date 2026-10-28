import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { HealthProbePort } from '../application/ports/health-probe.port';

@Injectable()
export class PrismaHealthProbe implements HealthProbePort {
  constructor(private readonly tx: TransactionHost) {}

  async checkDatabase(): Promise<void> {
    await this.tx.db.$queryRaw`SELECT 1`;
  }
}
