import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { IsolationLevel } from '../../application/ports/unit-of-work.port';
import { PrismaService, type ExtendedPrismaClient } from './prisma.service';

type NonQueryKeys = '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends';

/** Query surface common to the base client and an interactive transaction client. */
export type DbClient = Omit<ExtendedPrismaClient, NonQueryKeys>;

/**
 * Ambient transaction (AsyncLocalStorage). Repositories read `db`: the transaction client inside a unit
 * of work, the base client otherwise. No transaction object crosses a port.
 */
@Injectable()
export class TransactionHost {
  private readonly storage = new AsyncLocalStorage<{ tx: DbClient; isolation: IsolationLevel }>();

  constructor(private readonly prisma: PrismaService) {}

  get db(): DbClient {
    return this.storage.getStore()?.tx ?? this.prisma.client;
  }

  get inTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /** Isolation of the outermost open run, or `undefined` outside a unit of work. */
  get activeIsolation(): IsolationLevel | undefined {
    return this.storage.getStore()?.isolation;
  }

  /** The base client, for the unit of work to open transactions. */
  get base(): ExtendedPrismaClient {
    return this.prisma.client;
  }

  runIn<T>(tx: DbClient, isolation: IsolationLevel, work: () => Promise<T>): Promise<T> {
    return this.storage.run({ tx, isolation }, work);
  }

  /** The current transaction client; throws when called outside a unit of work (C12). */
  requireTransaction(what: string): DbClient {
    const store = this.storage.getStore();
    if (!store) throw new Error(`${what} must run inside a unit of work (UnitOfWorkPort.run)`);
    return store.tx;
  }
}
