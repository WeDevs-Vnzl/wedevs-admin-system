import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  COMPANY_FIELD_LIMITS,
  EMPTY_COMPANY_PROFILE,
  companyProfileChanges,
  companyProfileFromStored,
  normalizeCompanyProfile,
  type CompanyProfile,
} from './company-settings';

const profile = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  name: 'WeDevs',
  legalName: 'WeDevs Studio, C.A.',
  taxId: 'J-12345678-9',
  address: 'Calle Demo 1, Caracas',
  logoFileId: null,
  ...over,
});

function fieldErrorsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationFailedError);
    return (error as ValidationFailedError).fieldErrors ?? {};
  }
  throw new Error('expected a ValidationFailedError');
}

describe('normalizeCompanyProfile (port of fe/src/lib/validators/settings.ts company schema)', () => {
  it('requires a name and normalizes blank optionals (name trimmed, RIF trimmed)', () => {
    const parsed = normalizeCompanyProfile({ name: ' WeDevs ', legalName: '', taxId: ' J-123 ' });
    expect(parsed.name).toBe('WeDevs');
    expect(parsed.legalName).toBeNull();
    expect(parsed.taxId).toBe('J-123');
    expect(parsed.address).toBeNull();
    expect(parsed.logoFileId).toBeNull();
  });

  it('refuses a blank name with the required key', () => {
    expect(fieldErrorsOf(() => normalizeCompanyProfile({ name: ' ' }))).toEqual({
      name: ['validation.required'],
    });
    expect(fieldErrorsOf(() => normalizeCompanyProfile({ name: '' }))).toEqual({
      name: ['validation.required'],
    });
  });

  it('bounds every text field on the trimmed value', () => {
    const at = (max: number) => 'x'.repeat(max);
    const ok = normalizeCompanyProfile({
      name: at(COMPANY_FIELD_LIMITS.name),
      legalName: at(COMPANY_FIELD_LIMITS.legalName),
      taxId: at(COMPANY_FIELD_LIMITS.taxId),
      address: at(COMPANY_FIELD_LIMITS.address),
    });
    expect(ok.name).toHaveLength(COMPANY_FIELD_LIMITS.name);
    expect(
      fieldErrorsOf(() =>
        normalizeCompanyProfile({
          name: at(COMPANY_FIELD_LIMITS.name + 1),
          legalName: at(COMPANY_FIELD_LIMITS.legalName + 1),
          taxId: at(COMPANY_FIELD_LIMITS.taxId + 1),
          address: at(COMPANY_FIELD_LIMITS.address + 1),
        }),
      ),
    ).toEqual({
      name: ['validation.tooLong'],
      legalName: ['validation.tooLong'],
      taxId: ['validation.tooLong'],
      address: ['validation.tooLong'],
    });
    // Trimming happens before the bound: padding does not count.
    expect(
      normalizeCompanyProfile({ name: `  ${at(COMPANY_FIELD_LIMITS.name)}  ` }).name,
    ).toHaveLength(COMPANY_FIELD_LIMITS.name);
  });

  it('accepts a well-formed logo id and refuses a malformed or empty one', () => {
    expect(normalizeCompanyProfile({ name: 'A', logoFileId: 'fil_abc-123' }).logoFileId).toBe(
      'fil_abc-123',
    );
    expect(fieldErrorsOf(() => normalizeCompanyProfile({ name: 'A', logoFileId: '' }))).toEqual({
      logoFileId: ['validation.required'],
    });
    expect(
      fieldErrorsOf(() => normalizeCompanyProfile({ name: 'A', logoFileId: 'fil missing' })),
    ).toEqual({ logoFileId: ['validation.id.invalid'] });
    expect(
      fieldErrorsOf(() => normalizeCompanyProfile({ name: 'A', logoFileId: 'x'.repeat(65) })),
    ).toEqual({ logoFileId: ['validation.id.invalid'] });
  });

  it('reports every failing field together and never partially accepts', () => {
    const errors = fieldErrorsOf(() =>
      normalizeCompanyProfile({ name: '', taxId: 'x'.repeat(31), logoFileId: 'bad id' }),
    );
    expect(Object.keys(errors).sort()).toEqual(['logoFileId', 'name', 'taxId']);
  });
});

describe('companyProfileChanges (diffFields over the company fields)', () => {
  it('returns null when nothing changed, so no activity is logged', () => {
    expect(companyProfileChanges(profile(), profile())).toBeNull();
    expect(companyProfileChanges(EMPTY_COMPANY_PROFILE, EMPTY_COMPANY_PROFILE)).toBeNull();
  });

  it('records [before, after] for the fields that changed only', () => {
    expect(companyProfileChanges(profile(), profile({ name: 'WeDevs Studio' }))).toEqual({
      name: ['WeDevs', 'WeDevs Studio'],
    });
  });

  it('treats a missing optional and a null one as the same value', () => {
    const before = profile({ legalName: null });
    expect(companyProfileChanges(before, profile({ legalName: null }))).toBeNull();
  });
});

describe('companyProfileFromStored', () => {
  it('reads a missing or non-object row as the empty profile', () => {
    expect(companyProfileFromStored(undefined)).toEqual(EMPTY_COMPANY_PROFILE);
    expect(companyProfileFromStored(null)).toEqual(EMPTY_COMPANY_PROFILE);
    expect(companyProfileFromStored('company')).toEqual(EMPTY_COMPANY_PROFILE);
    expect(companyProfileFromStored([1, 2])).toEqual(EMPTY_COMPANY_PROFILE);
  });

  it('reads a stored profile field by field, replacing wrong types with the default', () => {
    expect(
      companyProfileFromStored({ name: 'WeDevs', legalName: 42, taxId: '', logoFileId: 'fil_1' }),
    ).toEqual({
      name: 'WeDevs',
      legalName: null,
      taxId: null,
      address: null,
      logoFileId: 'fil_1',
    });
    expect(companyProfileFromStored({ name: 7 }).name).toBe('');
  });
});
