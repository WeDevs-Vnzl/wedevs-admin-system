import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';

/**
 * Document category (PRD §8.9.1, HU-21): a configurable catalog row with a Spanish `name`, an optional
 * English `nameEn` and an optional `#RRGGBB` colour. Ported from `fe/src/lib/validators/document-types.ts`
 * and the category rules of `fe/src/mocks/services/document-types.ts`. Pure: no Zod, no framework, no clock.
 */

/** Maximum lengths, counted on the trimmed value (FE `requiredText(80)` / `optionalText(80)`). */
export const DOCUMENT_CATEGORY_LIMITS = { name: 80, nameEn: 80 } as const;

/** i18n keys (namespace `validation`), the same strings as the shared Zod messages. */
const KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
} as const;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** A category as stored. `order` is its 0-based position in the catalog (renumbered on every change). */
export interface DocumentCategory {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly color: string | null;
  readonly order: number;
}

/** What a caller sends for a category. Optional fields may be omitted or `null`. */
export interface DocumentCategoryInput {
  readonly name: string;
  readonly nameEn?: string | null;
  readonly color?: string | null;
}

/** The editable fields of a category (the order changes only through the reorder). */
export type DocumentCategoryFields = Omit<DocumentCategory, 'id' | 'order'>;

/** Trims a bounded optional text; blank becomes `null`, over the limit is a field error. */
function optionalText(
  value: string | null | undefined,
  max: number,
  field: string,
  errors: FieldErrors,
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
 * Validates and normalizes a category. Every failing field is reported together in `fieldErrors`
 * (`VALIDATION`, 422); nothing is partially accepted. A colour, when given, is exactly `#RRGGBB`.
 */
export function normalizeDocumentCategoryFields(
  input: DocumentCategoryInput,
): DocumentCategoryFields {
  const errors: FieldErrors = {};

  const name = input.name.trim();
  if (name.length === 0) errors.name = [KEYS.required];
  else if (name.length > DOCUMENT_CATEGORY_LIMITS.name) errors.name = [KEYS.tooLong];

  const nameEn = optionalText(input.nameEn, DOCUMENT_CATEGORY_LIMITS.nameEn, 'nameEn', errors);

  let color: string | null = null;
  if (input.color !== undefined && input.color !== null) {
    if (HEX_COLOR.test(input.color)) color = input.color;
    else errors.color = [KEYS.invalidFormat];
  }

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return { name, nameEn, color };
}

/** Category names are unique case-insensitively (mock `assertUniqueCategory`, `sameText`). */
export function sameCatalogName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * `true` when `orderedIds` is exactly the set `currentIds`, each id once, in any order (mock
 * `reorderDocumentCategories`: a missing, extra, unknown or repeated id is refused).
 */
export function isFullOrder(currentIds: readonly string[], orderedIds: readonly string[]): boolean {
  if (orderedIds.length !== currentIds.length) return false;
  const current = new Set(currentIds);
  return (
    new Set(orderedIds).size === orderedIds.length && orderedIds.every((id) => current.has(id))
  );
}
