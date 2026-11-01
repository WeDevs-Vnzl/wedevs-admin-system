import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import { DOCUMENT_CONTENT_MAX } from '../../../domain';

const TOO_LONG_KEY = 'validation.tooLong';
/** The markdown cap, for the DTO (interface does not import the domain). */
export const VERSION_CONTENT_MAX = DOCUMENT_CONTENT_MAX;
/** Longest changelog of a version (the FE `changelogSchema`). */
export const CHANGELOG_MAX = 500;

/** The trimmed changelog, `null` when blank; longer than `CHANGELOG_MAX` is `VALIDATION` on `changelog`. */
export function normalizeChangelog(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return null;
  if (trimmed.length > CHANGELOG_MAX) {
    throw new ValidationFailedError({ fieldErrors: { changelog: [TOO_LONG_KEY] } });
  }
  return trimmed;
}

/** A markdown body over the document cap is `VALIDATION` on `content` (never only in the DTO, lesson B2). */
export function assertContentSize(content: string): void {
  if (content.length > DOCUMENT_CONTENT_MAX) {
    throw new ValidationFailedError({ fieldErrors: { content: [TOO_LONG_KEY] } });
  }
}
