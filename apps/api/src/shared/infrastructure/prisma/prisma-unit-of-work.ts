import { Injectable } from '@nestjs/common';
import type {
  IsolationLevel,
  UnitOfWorkOptions,
  UnitOfWorkPort,
} from '../../application/ports/unit-of-work.port';
import { ConflictError } from '../../domain/domain-error';
import { TransactionHost, type DbClient } from './transaction-host';

const ISOLATION_RANK: Record<IsolationLevel, number> = {
  ReadCommitted: 0,
  RepeatableRead: 1,
  Serializable: 2,
};
const MAX_SERIALIZABLE_ATTEMPTS = 3;
const MAX_WAIT_MS = 10_000;
const TIMEOUT_MS = 30_000;

/** Postgres `40001` (serialization failure) / `40P01` (deadlock), as surfaced by Prisma or the adapter. */
// Observed with @prisma/adapter-pg 7.10: DriverAdapterError { message: 'TransactionWriteConflict', cause: { originalCode: '40001' } }.
export function isSerializationFailure(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 4) return false;
  const e = error as {
    code?: unknown;
    originalCode?: unknown;
    kind?: unknown;
    message?: unknown;
    cause?: unknown;
    meta?: unknown;
  };
  // Prisma P2034, raw SQLSTATE, or the driver-adapter shape (`kind: 'TransactionWriteConflict'`).
  if (e.code === 'P2034' || e.code === '40001' || e.code === '40P01') return true;
  if (e.originalCode === '40001' || e.originalCode === '40P01') return true;
  if (e.kind === 'TransactionWriteConflict') return true;
  if (
    typeof e.message === 'string' &&
    /could not serialize access|TransactionWriteConflict|deadlock detected/i.test(e.message)
  ) {
    return true;
  }
  return isSerializationFailure(e.cause, depth + 1) || isSerializationFailure(e.meta, depth + 1);
}

/**
 * Interactive `$transaction` with the requested isolation. A nested `run` joins the outer transaction unless it asks for a stricter isolation (then it throws).
 * Under `Serializable` a serialization failure retries the whole `work` (up to 3 attempts) and then
 * surfaces `ConflictError` (C18); `work` must therefore only have database side effects.
 */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly host: TransactionHost) {}

  async run<T>(work: () => Promise<T>, options: UnitOfWorkOptions = {}): Promise<T> {
    const isolation = options.isolation ?? 'ReadCommitted';
    const active = this.host.activeIsolation;
    if (active !== undefined) {
      // A nested run cannot raise the isolation of a transaction that is already open: programming error.
      if (ISOLATION_RANK[isolation] > ISOLATION_RANK[active]) {
        throw new Error(
          `Nested unit of work requests ${isolation} inside an outer ${active} transaction; open the outermost unit of work with ${isolation}`,
        );
      }
      return work();
    }
    const attempts = isolation === 'Serializable' ? MAX_SERIALIZABLE_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.host.base.$transaction(
          (tx) => this.host.runIn(tx as DbClient, isolation, work),
          {
            isolationLevel: isolation,
            maxWait: MAX_WAIT_MS,
            timeout: TIMEOUT_MS,
          },
        );
      } catch (error) {
        if (!isSerializationFailure(error)) throw error;
        if (attempt >= attempts) {
          throw new ConflictError();
        }
        // Jittered backoff so the competing transaction can commit before the retry starts.
        await new Promise((resolve) => setTimeout(resolve, attempt * 25 + Math.random() * 25));
      }
    }
  }
}
