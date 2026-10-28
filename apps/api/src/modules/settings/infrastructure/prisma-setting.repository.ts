import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import type { SettingRecord, SettingRepository } from '../application/ports/setting.repository';

/**
 * `Setting` rows through the current transaction (or the base client outside a unit of work). The JSON
 * value is passed through as is: the domain decides what the value means.
 */
@Injectable()
export class PrismaSettingRepository implements SettingRepository {
  constructor(private readonly host: TransactionHost) {}

  async find(key: string): Promise<SettingRecord | null> {
    const row = await this.host.db.setting.findUnique({ where: { key } });
    return row ? { key: row.key, value: row.value } : null;
  }

  async save(key: string, value: unknown): Promise<void> {
    const json = value as Prisma.InputJsonObject;
    await this.host.db.setting.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }
}
