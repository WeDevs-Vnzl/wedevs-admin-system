import { Injectable } from '@nestjs/common';
import type { UserPreferenceRepository } from '../application/ports/user-preference.repository.port';
import type { StoredPreference } from '../domain/preference';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

@Injectable()
export class PrismaUserPreferenceRepository implements UserPreferenceRepository {
  constructor(private readonly tx: TransactionHost) {}

  async listByUser(userId: string): Promise<StoredPreference[]> {
    const rows = await this.tx.db.userPreference.findMany({
      where: { userId },
      orderBy: { key: 'asc' },
    });
    return rows.map(({ key, value }) => ({ key, value }));
  }

  async upsert(userId: string, key: string, value: unknown): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await this.tx.db.userPreference.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value: json },
      update: { value: json },
    });
  }

  async remove(userId: string, key: string): Promise<void> {
    await this.tx.db.userPreference.deleteMany({ where: { userId, key } });
  }
}
