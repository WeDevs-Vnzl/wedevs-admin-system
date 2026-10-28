import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';

/**
 * Company profile (PRD §8.15 "Empresa", DT-44). Ported from the company part of
 * `fe/src/lib/validators/settings.ts`: trimmed text, blank optionals become `null`, bounded lengths and a
 * logo that is an id. Pure: no Zod, no framework, no clock.
 */

/** The `Setting` key that stores the profile (`Setting.key`, PRD §10.2). */
export const COMPANY_SETTING_KEY = 'company';

/** Maximum lengths, counted on the trimmed value (FE `requiredText` / `optionalText`). */
export const COMPANY_FIELD_LIMITS = {
  name: 120,
  legalName: 160,
  taxId: 30,
  address: 300,
} as const;

/** Entity id bounds (FE `idSchema`): opaque cuid-like string. */
const ID_MAX_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** i18n keys (namespace `validation`), the same strings as the shared Zod messages. */
/** i18n key of a malformed or unknown id (FE `VALIDATION_MESSAGES.invalidId`). */
export const INVALID_ID_KEY = 'validation.id.invalid';

const KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidId: INVALID_ID_KEY,
} as const;

/** Fields compared for the `SETTINGS_CHANGE` activity, in the order they are recorded. */
export const COMPANY_PROFILE_FIELDS = [
  'name',
  'legalName',
  'taxId',
  'address',
  'logoFileId',
] as const;

export type CompanyProfile = {
  readonly name: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly address: string | null;
  readonly logoFileId: string | null;
};

/** What a caller sends. Optional fields may be omitted or `null`; an omitted field clears the stored one. */
export type CompanyProfileInput = {
  readonly name: string;
  readonly legalName?: string | null;
  readonly taxId?: string | null;
  readonly address?: string | null;
  readonly logoFileId?: string | null;
};

/**
 * What a missing `company` row reads as. Empty on purpose: the FE fixture values (a placeholder RIF,
 * a demo name) would otherwise be printed on portal and print views as if they were the studio's data.
 */
export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  name: '',
  legalName: null,
  taxId: null,
  address: null,
  logoFileId: null,
};

/** Trims a bounded text field; blank becomes `null`, over the limit is a field error. */
function optionalField(
  value: string | null | undefined,
  max: number,
  field: string,
  errors: Record<string, string[]>,
): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    (errors[field] ??= []).push(KEYS.tooLong);
    return null;
  }
  return trimmed;
}

/**
 * Validates and normalizes a profile. Every failing field is reported together in `fieldErrors`
 * (`VALIDATION`, 422); nothing is partially accepted.
 */
export function normalizeCompanyProfile(input: CompanyProfileInput): CompanyProfile {
  const errors: FieldErrors = {};

  const name = input.name.trim();
  if (name.length === 0) errors.name = [KEYS.required];
  else if (name.length > COMPANY_FIELD_LIMITS.name) errors.name = [KEYS.tooLong];

  const legalName = optionalField(
    input.legalName,
    COMPANY_FIELD_LIMITS.legalName,
    'legalName',
    errors,
  );
  const taxId = optionalField(input.taxId, COMPANY_FIELD_LIMITS.taxId, 'taxId', errors);
  const address = optionalField(input.address, COMPANY_FIELD_LIMITS.address, 'address', errors);

  let logoFileId: string | null = null;
  if (input.logoFileId !== undefined && input.logoFileId !== null) {
    if (input.logoFileId.length === 0) errors.logoFileId = [KEYS.required];
    else if (input.logoFileId.length > ID_MAX_LENGTH || !ID_PATTERN.test(input.logoFileId)) {
      errors.logoFileId = [KEYS.invalidId];
    } else logoFileId = input.logoFileId;
  }

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return { name, legalName, taxId, address, logoFileId };
}

/**
 * Reads the stored JSON of the `company` row. A missing or malformed value reads as the empty profile
 * field by field, so a damaged row never breaks the portal and print views.
 */
export function companyProfileFromStored(stored: unknown): CompanyProfile {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return EMPTY_COMPANY_PROFILE;
  }
  const record = stored as Record<string, unknown>;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;
  return {
    name: typeof record.name === 'string' ? record.name : '',
    legalName: text(record.legalName),
    taxId: text(record.taxId),
    address: text(record.address),
    logoFileId: text(record.logoFileId),
  };
}

/** The `SETTINGS_CHANGE` change set between two profiles, or `null` when nothing changed. */
export function companyProfileChanges(
  before: CompanyProfile,
  after: CompanyProfile,
): ActivityChanges | null {
  return diffFields(before, after, { fields: COMPANY_PROFILE_FIELDS });
}
