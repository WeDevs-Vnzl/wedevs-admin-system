/**
 * Row classes a money mutation can lock, in the global lock order (BE-3): a unit of work takes its locks
 * in exactly this class order, each class ascending by `id COLLATE "C"`.
 */
export const ROW_LOCK_ORDER = [
  'Project',
  'Client',
  'BillingPlan',
  'RecurringCharge',
  'RecurringExpense',
  'BillingInstallment',
  'Invoice',
  'Payment',
  'Expense',
  'Account',
  'Document',
  'ShareLink',
] as const;

export type RowLockClass = (typeof ROW_LOCK_ORDER)[number];

/** Ids to lock per class. Order inside the object and inside each list is irrelevant: the adapter sorts. */
export type RowLockSet = { readonly [K in RowLockClass]?: readonly string[] };

/**
 * Takes the row locks of a unit of work once, up front, in the global lock order. Valid only inside
 * `UnitOfWorkPort.run`; the locks are held until the outermost unit of work ends.
 *
 * Rules of the second call in the same transaction, applied in this order:
 * 1. every requested row is already held (re-locking a subset, including an empty set): no-op;
 * 2. otherwise it adds a row, which could break the order: throws a plain `Error` (programming error).
 * An id that matches no row is held like any other (it locks nothing).
 */
export interface RowLocksPort {
  lock(set: RowLockSet): Promise<void>;
}
