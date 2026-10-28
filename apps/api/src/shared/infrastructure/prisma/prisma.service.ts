import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated-client';
import { APP_CONFIG } from '../../../config/config.module';
import type { AppConfig } from '../../../config/env.schema';
import { softDeleteExtension } from './soft-delete.extension';

function createClient(connectionString: string) {
  // Pool size: the `pg` default (max 10). No new environment variable (package 3.1 report).
  // The pool connects lazily, so constructing the client never needs a reachable database.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) }).$extends(
    softDeleteExtension,
  );
}

export type ExtendedPrismaClient = ReturnType<typeof createClient>;

/**
 * The only `PrismaClient` instantiation of the app (data-rules.md §3), with the soft-delete extension
 * applied. Repositories never inject this directly: they use `TransactionHost.db`.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: ExtendedPrismaClient;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'DATABASE_URL'>) {
    this.client = createClient(config.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
