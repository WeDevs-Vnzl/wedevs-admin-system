import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  DOCUMENT_CATEGORY_LIMITS,
  isFullOrder,
  normalizeDocumentCategoryFields,
  sameCatalogName,
} from './document-category';

// Ported from fe/src/lib/validators/document-types.test.ts ("document categories") and the category rules
// of fe/src/mocks/services/document-types.ts.
/** The `fieldErrors` a refused input carries (the test fails when the input is accepted). */
function fieldErrorsOf(action: () => unknown): Record<string, string[]> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationFailedError) return error.fieldErrors ?? {};
    throw error;
  }
  throw new Error('the input must be refused');
}

describe('document category fields', () => {
  it('accept a name with optional English name and colour (FE validator case)', () => {
    expect(normalizeDocumentCategoryFields({ name: 'Legal' })).toEqual({
      name: 'Legal',
      nameEn: null,
      color: null,
    });
    expect(
      normalizeDocumentCategoryFields({ name: 'Legal', nameEn: 'Legal', color: '#336699' }),
    ).toEqual({ name: 'Legal', nameEn: 'Legal', color: '#336699' });
  });

  it('rejects a blank name and a colour that is not #RRGGBB (FE validator case)', () => {
    expect(() => normalizeDocumentCategoryFields({ name: ' ' })).toThrow(ValidationFailedError);
    expect(() => normalizeDocumentCategoryFields({ name: 'Legal', color: 'blue' })).toThrow(
      ValidationFailedError,
    );
    expect(() => normalizeDocumentCategoryFields({ name: 'Legal', color: '#abc' })).toThrow(
      ValidationFailedError,
    );
  });

  it('trims the name and the English name, and blank optionals become null', () => {
    expect(normalizeDocumentCategoryFields({ name: '  Técnico  ', nameEn: '   ' })).toEqual({
      name: 'Técnico',
      nameEn: null,
      color: null,
    });
  });

  it('reports a blank name as validation.required and a long name as validation.tooLong', () => {
    expect(fieldErrorsOf(() => normalizeDocumentCategoryFields({ name: '   ' }))).toEqual({
      name: ['validation.required'],
    });
    const tooLong = 'x'.repeat(DOCUMENT_CATEGORY_LIMITS.name + 1);
    expect(fieldErrorsOf(() => normalizeDocumentCategoryFields({ name: tooLong }))).toEqual({
      name: ['validation.tooLong'],
    });
  });

  it('accepts the name limit exactly and reports every failing field together', () => {
    const atLimit = 'y'.repeat(DOCUMENT_CATEGORY_LIMITS.name);
    expect(normalizeDocumentCategoryFields({ name: atLimit }).name).toBe(atLimit);
    expect(
      fieldErrorsOf(() =>
        normalizeDocumentCategoryFields({
          name: '',
          nameEn: 'z'.repeat(DOCUMENT_CATEGORY_LIMITS.nameEn + 1),
          color: 'red',
        }),
      ),
    ).toEqual({
      name: ['validation.required'],
      nameEn: ['validation.tooLong'],
      color: ['validation.invalidFormat'],
    });
  });
});

// Mock rule: category names are unique, case-insensitively (`assertUniqueCategory`).
describe('category name comparison', () => {
  it('matches names case-insensitively and nothing else', () => {
    expect(sameCatalogName('legal', 'Legal')).toBe(true);
    expect(sameCatalogName('Legal', 'Legales')).toBe(false);
  });
});

// Mock rule: a reorder takes exactly the full id set, in any order (`reorderDocumentCategories`).
describe('category order completeness', () => {
  it('accepts exactly the current ids in any order', () => {
    expect(isFullOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
  });

  it('refuses a missing id, an extra id, an unknown id and a duplicate', () => {
    expect(isFullOrder(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(isFullOrder(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(isFullOrder(['a', 'b'], ['a', 'x'])).toBe(false);
    expect(isFullOrder(['a', 'b'], ['a', 'a'])).toBe(false);
  });
});
