import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  EXPENSE_CATEGORY_MESSAGES,
  assertExpenseCategoryPlacement,
  assertSiblingNameFree,
  buildExpenseCategoryTree,
  expenseCategoryChanges,
  expenseCategoryCreationChanges,
  normalizeExpenseCategoryFields,
  type ExpenseCategory,
} from './expense-category';

const category = (
  id: string,
  name: string,
  parentId: string | null,
  active = true,
): ExpenseCategory => ({ id, name, nameEn: null, color: null, parentId, active });

const INFRA = category('ecat_infra', 'Infraestructura', null);
const HOSTING = category('ecat_hosting', 'Hosting', 'ecat_infra');
const DBS = category('ecat_dbs', 'Bases de datos', 'ecat_infra');
const OTROS = category('ecat_otros', 'Otros', null);
const CATALOG = [INFRA, HOSTING, DBS, OTROS];

function fieldErrorsOf(action: () => unknown): Record<string, string[]> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationFailedError || error instanceof ConflictError) {
      return error.fieldErrors ?? {};
    }
    throw error;
  }
  return {};
}

describe('expense category input (catalogs.test "expense categories")', () => {
  it('accepts a root and a child, with the defaults active true and no color', () => {
    expect(normalizeExpenseCategoryFields({ name: 'Infraestructura' })).toEqual({
      name: 'Infraestructura',
      nameEn: null,
      color: null,
      parentId: null,
      active: true,
    });
    expect(
      normalizeExpenseCategoryFields({ name: 'Hosting', parentId: 'ecat_infra', color: '#336699' })
        .parentId,
    ).toBe('ecat_infra');
  });

  it('rejects a bad color', () => {
    expect(
      fieldErrorsOf(() => normalizeExpenseCategoryFields({ name: 'x', color: 'red' })),
    ).toEqual({ color: ['validation.invalidFormat'] });
  });

  it('rejects a category that is its own parent', () => {
    expect(
      fieldErrorsOf(() => normalizeExpenseCategoryFields({ name: 'x', parentId: 'c1' }, 'c1')),
    ).toEqual({ parentId: [EXPENSE_CATEGORY_MESSAGES.parentIsSelf] });
  });
});

describe('expense category placement (two levels)', () => {
  it('refuses a third level: a child of a child is not a root', () => {
    expect(
      fieldErrorsOf(() => assertExpenseCategoryPlacement(CATALOG, null, 'ecat_hosting')),
    ).toEqual({ parentId: [EXPENSE_CATEGORY_MESSAGES.parentNotRoot] });
  });

  it('refuses an unknown parent as not a root', () => {
    expect(
      fieldErrorsOf(() => assertExpenseCategoryPlacement(CATALOG, null, 'ecat_missing')),
    ).toEqual({ parentId: [EXPENSE_CATEGORY_MESSAGES.parentNotRoot] });
  });

  it('refuses to nest a root that has children', () => {
    expect(
      fieldErrorsOf(() => assertExpenseCategoryPlacement(CATALOG, INFRA, 'ecat_otros')),
    ).toEqual({ parentId: [EXPENSE_CATEGORY_MESSAGES.hasChildren] });
  });

  it('lets a root without children move under another root', () => {
    expect(() => assertExpenseCategoryPlacement(CATALOG, OTROS, 'ecat_infra')).not.toThrow();
  });

  it('accepts a root placement (no parent)', () => {
    expect(() => assertExpenseCategoryPlacement(CATALOG, INFRA, null)).not.toThrow();
  });

  it('refuses a repeated sibling name, case-insensitive, with CONFLICT on the name', () => {
    expect(fieldErrorsOf(() => assertSiblingNameFree(CATALOG, 'hosting', 'ecat_infra'))).toEqual({
      name: [EXPENSE_CATEGORY_MESSAGES.nameTaken],
    });
    expect(() => assertSiblingNameFree(CATALOG, 'Hosting', 'ecat_otros')).not.toThrow();
  });

  it('lets a category keep its own name on update', () => {
    expect(() =>
      assertSiblingNameFree(CATALOG, 'Hosting', 'ecat_infra', 'ecat_hosting'),
    ).not.toThrow();
  });
});

describe('expense category tree', () => {
  it('returns two levels: roots with their children, children without children', () => {
    const tree = buildExpenseCategoryTree(CATALOG, false);
    expect(tree.map((node) => node.name)).toEqual(['Infraestructura', 'Otros']);
    expect(tree[0]?.children.map((child) => child.name)).toEqual(['Bases de datos', 'Hosting']);
    expect(tree[0]?.children.every((child) => child.parentId === 'ecat_infra')).toBe(true);
  });

  it('hides an inactive child or root unless asked', () => {
    const rows = [INFRA, { ...HOSTING, active: false }, DBS, { ...OTROS, active: false }];
    const active = buildExpenseCategoryTree(rows, false);
    expect(active.map((node) => node.name)).toEqual(['Infraestructura']);
    expect(active[0]?.children.map((child) => child.name)).toEqual(['Bases de datos']);

    const all = buildExpenseCategoryTree(rows, true);
    expect(all.map((node) => node.name)).toEqual(['Infraestructura', 'Otros']);
    expect(all[0]?.children.map((child) => child.name)).toEqual(['Bases de datos', 'Hosting']);
  });

  it('an inactive root takes its children with it', () => {
    const rows = [{ ...INFRA, active: false }, HOSTING, DBS];
    expect(buildExpenseCategoryTree(rows, false)).toEqual([]);
  });
});

describe('expense category change sets', () => {
  it('records a creation as one expenseCategory entry', () => {
    expect(expenseCategoryCreationChanges('Eventos')).toEqual({
      expenseCategory: [null, 'Eventos'],
    });
  });

  it('records only the changed fields', () => {
    const next = { name: 'Infra', nameEn: null, color: '#000000', parentId: null, active: false };
    expect(expenseCategoryChanges(INFRA, next)).toEqual({
      name: ['Infraestructura', 'Infra'],
      color: [null, '#000000'],
      active: [true, false],
    });
    const same = { name: INFRA.name, nameEn: null, color: null, parentId: null, active: true };
    expect(expenseCategoryChanges(INFRA, same)).toBeNull();
  });
});
