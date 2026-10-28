import { createZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Global Zod error map and validation pipe (C1, C8). Zod's built-in messages are English prose; the
 * map turns every issue without a custom message into a `validation.*` i18n key, so a schema never
 * leaks prose to the API. Custom messages (schema- or check-level) keep precedence.
 *
 * Importing this module installs the map (idempotent), as the FE `zod.ts` does: the map is read
 * lazily at parse time, so import order does not matter.
 */

/** Generic keys (namespace `validation`); merged into `VALIDATION_MESSAGES`. */
export const GENERIC_VALIDATION_MESSAGES = {
  required: 'validation.required',
  invalidFormat: 'validation.invalidFormat',
  invalidEmail: 'validation.invalidEmail',
  invalidOption: 'validation.invalidOption',
  tooShort: 'validation.tooShort',
  tooLong: 'validation.tooLong',
  tooSmall: 'validation.tooSmall',
  tooLarge: 'validation.tooLarge',
  positive: 'validation.positive',
  nonNegative: 'validation.nonNegative',
} as const;

const M = GENERIC_VALIDATION_MESSAGES;

const LENGTH_ORIGINS: ReadonlySet<string> = new Set(['string', 'array', 'set']);

type RawIssue = z.core.$ZodRawIssue;

/** `null`/`undefined` is how a cleared field reaches the schema: it means "nothing provided". */
function isEmptyInput(input: unknown): boolean {
  return input === undefined || input === null;
}

export function genericIssueMessage(issue: RawIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return isEmptyInput(issue.input) ? M.required : M.invalidFormat;
    case 'invalid_value':
      return isEmptyInput(issue.input) ? M.required : M.invalidOption;
    case 'too_small':
      if (issue.origin === 'string' && issue.minimum === 1) return M.required;
      if (LENGTH_ORIGINS.has(issue.origin)) return M.tooShort;
      if (issue.origin === 'number' && issue.minimum === 0) {
        return issue.inclusive ? M.nonNegative : M.positive;
      }
      return M.tooSmall;
    case 'too_big':
      return LENGTH_ORIGINS.has(issue.origin) ? M.tooLong : M.tooLarge;
    case 'invalid_format':
      return issue.format === 'email' ? M.invalidEmail : M.invalidFormat;
    default:
      return M.invalidFormat;
  }
}

/** Installs the global error map. Safe to call more than once. */
export function installZodErrorMap(): void {
  z.config({ customError: genericIssueMessage });
}

installZodErrorMap();

/**
 * Global validation pipe: validates against the nestjs-zod DTO of each parameter and throws
 * `ZodValidationException`, which the HTTP error filter maps to 422 `VALIDATION`.
 */
export class AppZodValidationPipe extends createZodValidationPipe() {}
