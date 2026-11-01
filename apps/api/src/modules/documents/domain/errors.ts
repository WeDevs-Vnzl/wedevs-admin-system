/**
 * i18n keys of the documents domain errors, verbatim from the Hito 1 mock (`validators/documents.ts`,
 * `mocks/services/documents.ts`). The FE already ships the translations; the BE returns keys, never
 * translated text (api-contract §4).
 */

/** `documents.validation.*`: the type rules (PRD §8.9.1, §8.9.4). */
export const DOCUMENT_VALIDATION_MESSAGES = {
  signedAtNotAllowed: 'documents.validation.signedAtNotAllowed',
  expiresAtNotAllowed: 'documents.validation.expiresAtNotAllowed',
  signedStatusNotAllowed: 'documents.validation.signedStatusNotAllowed',
} as const;

/** `documents.errors.*`. */
export const DOCUMENT_ERRORS = {
  invalidTransition: 'documents.errors.invalidTransition',
} as const;

/** Generic `validation.*` keys the document rules raise on a field (as `VALIDATION_MESSAGES`). */
export const DOCUMENT_FIELD_ERRORS = {
  required: 'validation.required',
  invalidDate: 'validation.date.invalid',
  invalidOption: 'validation.invalidOption',
  invalidFormat: 'validation.invalidFormat',
} as const;
