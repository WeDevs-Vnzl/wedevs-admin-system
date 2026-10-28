import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import { DOCUMENT_TYPE_LIMITS, normalizeDocumentTypeFields } from './document-type';

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

const valid = {
  categoryId: 'dcat_legal',
  name: 'Contrato de servicios',
  nameEn: null,
  requiresSignature: false,
  hasExpiration: false,
  defaultFormat: 'ARCHIVO' as const,
  active: true,
};

// Ported from fe/src/lib/validators/document-types.test.ts ("document types") and the type rules of
// fe/src/mocks/services/document-types.ts (capabilities, format, English name, active flag).
describe('document type fields', () => {
  it('keep the capability flags, an English name and every format (FE validator case)', () => {
    for (const defaultFormat of ['MARKDOWN', 'ARCHIVO', 'ENLACE'] as const) {
      expect(
        normalizeDocumentTypeFields({
          ...valid,
          nameEn: 'Services agreement',
          requiresSignature: true,
          hasExpiration: true,
          defaultFormat,
        }),
      ).toEqual({
        categoryId: 'dcat_legal',
        name: 'Contrato de servicios',
        nameEn: 'Services agreement',
        requiresSignature: true,
        hasExpiration: true,
        defaultFormat,
        active: true,
      });
    }
  });

  it('trim the name, and a blank English name becomes null', () => {
    expect(normalizeDocumentTypeFields({ ...valid, name: '  NDA  ', nameEn: '  ' }).name).toBe(
      'NDA',
    );
    expect(normalizeDocumentTypeFields({ ...valid, nameEn: '   ' }).nameEn).toBeNull();
  });

  it('refuse a blank name, a missing category and an unknown format (FE validator case)', () => {
    expect(fieldErrorsOf(() => normalizeDocumentTypeFields({ ...valid, name: '' }))).toEqual({
      name: ['validation.required'],
    });
    expect(
      fieldErrorsOf(() => normalizeDocumentTypeFields({ ...valid, categoryId: '  ' })),
    ).toEqual({ categoryId: ['validation.required'] });
    expect(
      fieldErrorsOf(() =>
        normalizeDocumentTypeFields({ ...valid, defaultFormat: 'PDF' as 'ARCHIVO' }),
      ),
    ).toEqual({ defaultFormat: ['validation.invalidOption'] });
  });

  it('bound the name and the English name', () => {
    const name = 'n'.repeat(DOCUMENT_TYPE_LIMITS.name);
    expect(normalizeDocumentTypeFields({ ...valid, name }).name).toBe(name);
    expect(
      fieldErrorsOf(() =>
        normalizeDocumentTypeFields({ ...valid, name: `${name}n`, nameEn: 'e'.repeat(121) }),
      ),
    ).toEqual({ name: ['validation.tooLong'], nameEn: ['validation.tooLong'] });
  });
});
