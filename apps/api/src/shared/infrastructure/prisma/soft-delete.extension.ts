import { Prisma } from './generated-client';

/** Models with `deletedAt` (data-rules.md §6). Everything else is never soft-deleted. */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set([
  'User',
  'Client',
  'Contact',
  'Project',
  'Invoice',
  'PaymentAllocation',
  'Payment',
  'Account',
  'AccountTransfer',
  'AccountMovement',
  'Expense',
  'RecurringExpense',
  'Document',
  'Note',
  'File',
]);

interface WhereArgs {
  where?: Record<string, unknown>;
}

/**
 * Adds `deletedAt: null` unless the caller states a `deletedAt` key at the top level of `where`.
 * `archivedWhere('only' | 'include')` in `prisma-list.ts` is the single way to opt in (`include` sets the
 * key to `undefined`, which Prisma ignores, so the row set is unfiltered).
 */
function withDefaultFilter<A extends WhereArgs | undefined>(args: A): A {
  const current = args?.where;
  if (current !== undefined && 'deletedAt' in current) return args;
  return { ...args, where: { ...current, deletedAt: null } } as A;
}

/**
 * Soft-delete client extension (PRD §7.7, C19). Filters `findMany`, `findFirst`, `findFirstOrThrow`,
 * `count`, `aggregate` and `groupBy` of the soft-delete models.
 *
 * Deliberately NOT filtered:
 * - `findUnique` / `findUniqueOrThrow`: they accept only unique selectors, so repositories load by id
 *   and check `deletedAt` themselves (C14).
 * - Relation filters, `include` and `select` of nested relations: repositories filter them explicitly.
 * - Raw queries and writes.
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    $allModels: {
      findMany: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withDefaultFilter(args) : args),
      findFirst: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withDefaultFilter(args) : args),
      findFirstOrThrow: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withDefaultFilter(args) : args),
      count: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withDefaultFilter(args) : args),
      aggregate: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withDefaultFilter(args) : args),
      groupBy: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withDefaultFilter(args) : args),
    },
  },
});
