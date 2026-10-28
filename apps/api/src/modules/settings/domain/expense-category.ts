import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import {
  ConflictError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../shared/domain/domain-error';

/**
 * Expense category tree (PRD §8.8, §8.15, §10.2 `ExpenseCategory`). Ported from the expense-category part of
 * `fe/src/lib/validators/catalogs.ts` and `fe/src/mocks/services/catalogs.ts`. Pure: no framework, no clock.
 * The tree has exactly two levels: a category is a root or a child of a root (depth ≤ 2). Rows are retired by
 * deactivating them (C19).
 */

export const EXPENSE_CATEGORY_LIMITS = { name: 120, nameEn: 120 } as const;

/** `#RRGGBB`, the color of a category (FE `hexColorSchema`). */
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Fields compared for the `SETTINGS_CHANGE` activity of an update. */
export const EXPENSE_CATEGORY_CHANGE_FIELDS = [
  'name',
  'nameEn',
  'color',
  'parentId',
  'active',
] as const;

/** i18n keys of the expense category rules (namespace `catalogs`; shape errors in `validation`). */
export const EXPENSE_CATEGORY_MESSAGES = {
  nameTaken: 'catalogs.expenseCategories.errors.nameTaken',
  parentNotRoot: 'catalogs.expenseCategories.errors.parentNotRoot',
  hasChildren: 'catalogs.expenseCategories.errors.hasChildren',
  parentIsSelf: 'catalogs.validation.categoryParentIsSelf',
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
} as const;

export type ExpenseCategory = {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly color: string | null;
  readonly parentId: string | null;
  readonly active: boolean;
};

/** A root category with its children; children carry no children (two levels). */
export type ExpenseCategoryTreeNode = ExpenseCategory & {
  readonly children: readonly ExpenseCategory[];
};

/** The editable part of a category (everything but the id). */
export type ExpenseCategoryFields = {
  readonly name: string;
  readonly nameEn: string | null;
  readonly color: string | null;
  readonly parentId: string | null;
  readonly active: boolean;
};

/** What a caller sends. A missing `parentId` makes a root; a missing `active` is true. */
export type ExpenseCategoryFieldsInput = {
  readonly name: string;
  readonly nameEn?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly parentId?: string | null | undefined;
  readonly active?: boolean | undefined;
};

/** Trims a required text; records the field error and returns the trimmed text either way. */
function requiredText(value: string, max: number, field: string, errors: FieldErrors): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) (errors[field] ??= []).push(EXPENSE_CATEGORY_MESSAGES.required);
  else if (trimmed.length > max) (errors[field] ??= []).push(EXPENSE_CATEGORY_MESSAGES.tooLong);
  return trimmed;
}

/**
 * Validates and normalizes the editable fields. `selfId` is the category being updated: it cannot be its own
 * parent. Every failing field is reported together.
 */
export function normalizeExpenseCategoryFields(
  input: ExpenseCategoryFieldsInput,
  selfId?: string,
): ExpenseCategoryFields {
  const errors: FieldErrors = {};
  const name = requiredText(input.name, EXPENSE_CATEGORY_LIMITS.name, 'name', errors);

  const rawNameEn = (input.nameEn ?? '').trim();
  let nameEn: string | null = null;
  if (rawNameEn.length > EXPENSE_CATEGORY_LIMITS.nameEn) {
    errors.nameEn = [EXPENSE_CATEGORY_MESSAGES.tooLong];
  } else if (rawNameEn.length > 0) {
    nameEn = rawNameEn;
  }

  const color = input.color ?? null;
  if (color !== null && !HEX_COLOR_PATTERN.test(color)) {
    errors.color = [EXPENSE_CATEGORY_MESSAGES.invalidFormat];
  }

  const parentId = input.parentId ?? null;
  if (parentId !== null && selfId !== undefined && parentId === selfId) {
    errors.parentId = [EXPENSE_CATEGORY_MESSAGES.parentIsSelf];
  }

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return { name, nameEn, color, parentId, active: input.active ?? true };
}

/**
 * The parent of a placement must be an existing root (depth ≤ 2), and a category that has children stays a
 * root. Returns the `VALIDATION` field errors, or `null` when the placement is valid.
 */
export function expenseCategoryPlacementErrors(
  categories: readonly ExpenseCategory[],
  self: ExpenseCategory | null,
  parentId: string | null,
): FieldErrors | null {
  if (parentId === null) return null;
  const parent = categories.find((row) => row.id === parentId);
  if (!parent || parent.parentId !== null) {
    return { parentId: [EXPENSE_CATEGORY_MESSAGES.parentNotRoot] };
  }
  if (self !== null && categories.some((row) => row.parentId === self.id)) {
    return { parentId: [EXPENSE_CATEGORY_MESSAGES.hasChildren] };
  }
  return null;
}

/** Throws `VALIDATION` on an invalid placement (see `expenseCategoryPlacementErrors`). */
export function assertExpenseCategoryPlacement(
  categories: readonly ExpenseCategory[],
  self: ExpenseCategory | null,
  parentId: string | null,
): void {
  const errors = expenseCategoryPlacementErrors(categories, self, parentId);
  if (errors !== null) throw new ValidationFailedError({ fieldErrors: errors });
}

const sameText = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Names are unique among the siblings of one parent, case-insensitive (`CONFLICT` on the name). `selfId` is
 * the category being updated and may keep its own name.
 */
export function assertSiblingNameFree(
  categories: readonly ExpenseCategory[],
  name: string,
  parentId: string | null,
  selfId?: string,
): void {
  const taken = categories.some(
    (row) => row.id !== selfId && row.parentId === parentId && sameText(row.name, name),
  );
  if (taken) {
    throw new ConflictError({ fieldErrors: { name: [EXPENSE_CATEGORY_MESSAGES.nameTaken] } });
  }
}

const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

/**
 * The two-level tree for Settings and pickers: every visible root with its visible children. Without
 * `includeInactive` an inactive category is hidden, and an inactive root takes its children with it.
 * Sorted by name at each level (the catalog has no stored sort column).
 */
export function buildExpenseCategoryTree(
  categories: readonly ExpenseCategory[],
  includeInactive: boolean,
): ExpenseCategoryTreeNode[] {
  const visible = (row: ExpenseCategory): boolean => includeInactive || row.active;
  return categories
    .filter((row) => row.parentId === null && visible(row))
    .sort(byName)
    .map((root) => ({
      ...root,
      children: categories.filter((row) => row.parentId === root.id && visible(row)).sort(byName),
    }));
}

/** The `SETTINGS_CHANGE` change set of an update, or `null` when nothing changed. */
export function expenseCategoryChanges(
  before: ExpenseCategory,
  after: ExpenseCategoryFields,
): ActivityChanges | null {
  return diffFields(before, after, { fields: EXPENSE_CATEGORY_CHANGE_FIELDS });
}

/** The `SETTINGS_CHANGE` change set of a creation: the name, from nothing. */
export function expenseCategoryCreationChanges(name: string): ActivityChanges {
  return { expenseCategory: [null, name] };
}
