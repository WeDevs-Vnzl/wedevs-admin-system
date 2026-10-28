import { DOCUMENT_FORMAT_VALUES, type DocumentFormat } from '../../../shared/domain/enums';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';

/**
 * Document type (PRD §8.9.1, HU-21): a configurable type inside a category. Its capabilities decide what
 * its documents may carry: `requiresSignature` (the `FIRMADO` status and signature date), `hasExpiration`
 * (the expiry date and its alerts), `defaultFormat` and `active` (inactive types are not offered for new
 * documents). Ported from `fe/src/lib/validators/document-types.ts` and the type rules of
 * `fe/src/mocks/services/document-types.ts`. Pure: no Zod, no framework, no clock.
 */

/** Maximum lengths, counted on the trimmed value (FE `requiredText(120)` / `optionalText(120)`). */
export const DOCUMENT_TYPE_LIMITS = { name: 120, nameEn: 120 } as const;

/** i18n keys (namespace `validation`), the same strings as the shared Zod messages. */
const KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidOption: 'validation.invalidOption',
} as const;

/** A type as stored. `categoryId` names the category it belongs to (the category is checked by the caller). */
export interface DocumentType {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly requiresSignature: boolean;
  readonly hasExpiration: boolean;
  readonly defaultFormat: DocumentFormat;
  readonly active: boolean;
}

/** What a caller sends for a type (the DTO applies the defaults before this point). */
export interface DocumentTypeInput {
  readonly categoryId: string;
  readonly name: string;
  readonly nameEn?: string | null;
  readonly requiresSignature: boolean;
  readonly hasExpiration: boolean;
  readonly defaultFormat: DocumentFormat;
  readonly active: boolean;
}

/** The editable fields of a type; the id is never part of them. */
export type DocumentTypeFields = Omit<DocumentType, 'id'>;

/**
 * Validates and normalizes a type. Every failing field is reported together in `fieldErrors`
 * (`VALIDATION`, 422). The category's existence is checked by the catalog, not here.
 */
export function normalizeDocumentTypeFields(input: DocumentTypeInput): DocumentTypeFields {
  const errors: FieldErrors = {};

  const categoryId = input.categoryId.trim();
  if (categoryId.length === 0) errors.categoryId = [KEYS.required];

  const name = input.name.trim();
  if (name.length === 0) errors.name = [KEYS.required];
  else if (name.length > DOCUMENT_TYPE_LIMITS.name) errors.name = [KEYS.tooLong];

  const trimmedEn = (input.nameEn ?? '').trim();
  let nameEn: string | null = null;
  if (trimmedEn.length > DOCUMENT_TYPE_LIMITS.nameEn) errors.nameEn = [KEYS.tooLong];
  else if (trimmedEn.length > 0) nameEn = trimmedEn;

  if (!(DOCUMENT_FORMAT_VALUES as readonly string[]).includes(input.defaultFormat)) {
    errors.defaultFormat = [KEYS.invalidOption];
  }

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return {
    categoryId,
    name,
    nameEn,
    requiresSignature: input.requiresSignature,
    hasExpiration: input.hasExpiration,
    defaultFormat: input.defaultFormat,
    active: input.active,
  };
}
