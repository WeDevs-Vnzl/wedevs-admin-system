import type { CurrentUser } from '../../../../shared/application/current-user';
import type { EntityRef } from '../../../../shared/domain/entity-ref';

export const EXPENSE_REFERENCES = Symbol('EXPENSE_REFERENCES');
export const EXPENSE_RECEIPT_FILES = Symbol('EXPENSE_RECEIPT_FILES');

export interface ExpenseAccountRef {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
}

/**
 * What an expense points at, checked against the database (a client id is never trusted, C14). Every method
 * answers `null` for an unknown, inactive or archived row; the use case throws its own `VALIDATION`.
 * Valid inside the caller's unit of work, after it took the row locks.
 */
export interface ExpenseReferencesPort {
  /** An active category of the two-level catalog. */
  activeCategory(id: string): Promise<{ id: string } | null>;
  /** An active, not archived company account. */
  activeAccount(id: string): Promise<ExpenseAccountRef | null>;
  /** A live (not archived) project of the imputation. */
  liveProject(id: string): Promise<EntityRef | null>;
}

export interface ReservedExpenseReceipt {
  readonly id: string;
}

/**
 * Claims a file as an expense receipt (C23). Valid only inside the expense's unit of work: it takes the file
 * row lock a concurrent delete also takes. Throws `NOT_FOUND` for a file that is unknown, not `READY`, or
 * neither the caller's own upload nor claimed by a resource the caller can read.
 */
export interface ExpenseReceiptFilesPort {
  reserve(actor: CurrentUser, fileId: string): Promise<ReservedExpenseReceipt>;
}
