import { z } from "zod";

/**
 * Global Zod error map (C1, C2). Zod's built-in messages are English prose; this maps every issue code
 * that carries no custom message to a `validation.*` i18n key, so a schema never leaks prose to the UI.
 * Custom messages (schema- or check-level) keep precedence over this map.
 *
 * Installed by `./zod`, the only module validators import `z` from (ESLint forbids `"zod"` elsewhere in
 * `src/`), so every schema is built after the map exists. Keys here have no interpolation: a Zod message
 * is a plain string, so limits are not available to the translation.
 */

/** Generic keys (namespace `validation`) produced by the global error map; merged into `VALIDATION_MESSAGES`. */
export const GENERIC_VALIDATION_MESSAGES = {
  required: "validation.required",
  invalidFormat: "validation.invalidFormat",
  invalidEmail: "validation.invalidEmail",
  invalidOption: "validation.invalidOption",
  tooShort: "validation.tooShort",
  tooLong: "validation.tooLong",
  tooSmall: "validation.tooSmall",
  tooLarge: "validation.tooLarge",
  positive: "validation.positive",
  nonNegative: "validation.nonNegative",
} as const;

const M = GENERIC_VALIDATION_MESSAGES;

/** Origins measured by length/size of a collection or text, as opposed to a numeric/date magnitude. */
const LENGTH_ORIGINS: ReadonlySet<string> = new Set(["string", "array", "set"]);

type RawIssue = z.core.$ZodRawIssue;

export function genericIssueMessage(issue: RawIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined ? M.required : M.invalidFormat;
    case "invalid_value":
      return M.invalidOption;
    case "too_small":
      if (issue.origin === "string" && issue.minimum === 1) return M.required; // `.min(1)` = non-empty
      if (LENGTH_ORIGINS.has(issue.origin)) return M.tooShort;
      if (issue.origin === "number" && issue.minimum === 0) {
        return issue.inclusive ? M.nonNegative : M.positive;
      }
      return M.tooSmall;
    case "too_big":
      return LENGTH_ORIGINS.has(issue.origin) ? M.tooLong : M.tooLarge;
    case "invalid_format":
      return issue.format === "email" ? M.invalidEmail : M.invalidFormat;
    default:
      return M.invalidFormat;
  }
}

z.config({ customError: genericIssueMessage });
