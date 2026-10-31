import { Injectable } from '@nestjs/common';
import {
  ROW_LOCK_ORDER,
  type RowLockClass,
  type RowLockSet,
  type RowLocksPort,
} from '../../application/ports/row-locks.port';
import { TransactionHost, type DbClient } from './transaction-host';

/** Table of each lockable class: a closed whitelist, so the identifier is never caller input. */
const TABLE: Record<RowLockClass, string> = {
  Project: '"Project"',
  Client: '"Client"',
  BillingPlan: '"BillingPlan"',
  RecurringCharge: '"RecurringCharge"',
  RecurringExpense: '"RecurringExpense"',
  BillingInstallment: '"BillingInstallment"',
  Invoice: '"Invoice"',
  Payment: '"Payment"',
  Expense: '"Expense"',
  Account: '"Account"',
};

/**
 * `SELECT ... FOR UPDATE` per class in the global lock order, each ascending by `id COLLATE "C"`.
 * The rows held by each open transaction are remembered so a second call can only re-lock a subset.
 */
@Injectable()
export class PrismaRowLocks implements RowLocksPort {
  private readonly held = new WeakMap<DbClient, Map<RowLockClass, Set<string>>>();

  constructor(private readonly host: TransactionHost) {}

  async lock(set: RowLockSet): Promise<void> {
    const tx = this.host.requireTransaction('RowLocksPort.lock');
    const requested = ROW_LOCK_ORDER.flatMap((rowClass): [RowLockClass, string[]][] => {
      const ids = [...new Set(set[rowClass] ?? [])];
      return ids.length > 0 ? [[rowClass, ids]] : [];
    });
    const already = this.held.get(tx);
    if (already) {
      for (const [rowClass, ids] of requested) {
        if (ids.some((id) => !already.get(rowClass)?.has(id))) {
          throw new Error(
            `RowLocksPort: a second lock call in the same transaction adds ${rowClass} rows; lock every row up front`,
          );
        }
      }
      return;
    }
    // Recorded before the statements run: a failed statement aborts the transaction anyway.
    this.held.set(tx, new Map(requested.map(([rowClass, ids]) => [rowClass, new Set(ids)])));
    for (const [rowClass, ids] of requested) {
      await tx.$queryRawUnsafe(
        `SELECT "id" FROM ${TABLE[rowClass]} WHERE "id" = ANY($1::text[]) ORDER BY "id" COLLATE "C" FOR UPDATE`,
        ids,
      );
    }
  }
}
