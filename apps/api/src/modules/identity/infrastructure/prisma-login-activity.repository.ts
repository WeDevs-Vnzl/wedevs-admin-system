import { Injectable } from '@nestjs/common';
import type { LoginActivityRepository } from '../application/ports/login-activity.repository.port';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

@Injectable()
export class PrismaLoginActivityRepository implements LoginActivityRepository {
  constructor(private readonly host: TransactionHost) {}

  async existsForEvent(svixId: string): Promise<boolean> {
    const tx = this.host.requireTransaction('LoginActivityRepository.existsForEvent');
    // Two deliveries of the same event serialize here: the second one sees the first one's committed entry.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity:login:${svixId}`}))`;
    const found = await tx.activityLog.findFirst({
      where: { action: 'LOGIN', metadata: { path: ['svixId'], equals: svixId } },
      select: { id: true },
    });
    return found !== null;
  }
}
