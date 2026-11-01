import type { DateOnly } from '../../../shared/domain/business-date';
import type { DocumentFormat, DocumentStatus } from '../../../shared/domain/enums';
import {
  ConflictError,
  IntegrityLockedError,
  ValidationFailedError,
} from '../../../shared/domain/domain-error';
import { DOCUMENT_ERRORS, DOCUMENT_FIELD_ERRORS, DOCUMENT_VALIDATION_MESSAGES } from './errors';

/**
 * Document rules (PRD §8.9, DT-138, C19). Ported from `validators/documents.ts` and the mock service.
 * Pure: dates arrive as parameters, nothing reads a clock.
 */

/** Markdown / draft size cap (characters). */
export const DOCUMENT_CONTENT_MAX = 1_000_000;
export const DEFAULT_ALERT_DAYS_BEFORE = 30;
const HTTP_URL_MAX_LENGTH = 2048;

/** What the rules need of a document type (`DocumentType` capabilities). */
export interface DocumentTypeCapabilities {
  readonly requiresSignature: boolean;
  readonly hasExpiration: boolean;
}

// ───────────────────────────── Statuses and transitions ─────────────────────────────

/** Statuses a person can set. `VENCIDO` is assigned by the expiry step only. */
export const USER_SETTABLE_DOCUMENT_STATUS_VALUES = [
  'BORRADOR',
  'EN_REVISION',
  'APROBADO',
  'ENVIADO',
  'FIRMADO',
  'ANULADO',
] as const satisfies readonly DocumentStatus[];
export type UserSettableDocumentStatus = (typeof USER_SETTABLE_DOCUMENT_STATUS_VALUES)[number];

/**
 * Allowed transitions (PRD §8.9.4): `BORRADOR ⇄ EN_REVISION → APROBADO → ENVIADO → FIRMADO → VENCIDO`
 * (automatic); any status except `VENCIDO` can go to `ANULADO`.
 */
export const DOCUMENT_STATUS_TRANSITIONS: Readonly<
  Record<DocumentStatus, readonly DocumentStatus[]>
> = {
  BORRADOR: ['EN_REVISION', 'ANULADO'],
  EN_REVISION: ['BORRADOR', 'APROBADO', 'ANULADO'],
  APROBADO: ['ENVIADO', 'ANULADO'],
  ENVIADO: ['FIRMADO', 'ANULADO'],
  FIRMADO: ['ANULADO'],
  VENCIDO: [],
  ANULADO: [],
};

/** `FIRMADO` additionally needs a type with `requiresSignature`. */
export function canTransitionDocument(
  from: DocumentStatus,
  to: DocumentStatus,
  caps: Pick<DocumentTypeCapabilities, 'requiresSignature'>,
): boolean {
  if (to === 'FIRMADO' && !caps.requiresSignature) return false;
  return DOCUMENT_STATUS_TRANSITIONS[from].includes(to);
}

function isUserSettable(status: DocumentStatus): status is UserSettableDocumentStatus {
  return (USER_SETTABLE_DOCUMENT_STATUS_VALUES as readonly DocumentStatus[]).includes(status);
}

/**
 * The checks of `setDocumentStatus`, in the mock's order: a person never sets `VENCIDO`; `FIRMADO` needs its
 * signature date and a type with signature; then the transition table. Failures are `VALIDATION` on the field.
 */
export function assertStatusChange(
  from: DocumentStatus,
  to: DocumentStatus,
  caps: DocumentTypeCapabilities,
  signedAt: DateOnly | undefined,
): void {
  if (!isUserSettable(to)) {
    throw new ValidationFailedError({
      fieldErrors: { status: [DOCUMENT_FIELD_ERRORS.invalidOption] },
    });
  }
  const fieldErrors: Record<string, string[]> = {};
  if (to === 'FIRMADO' && !signedAt) fieldErrors.signedAt = [DOCUMENT_FIELD_ERRORS.required];
  const issues = documentTypeRuleIssues(caps, { status: to, signedAt });
  for (const issue of issues) (fieldErrors[issue.path] ??= []).push(issue.message);
  if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });
  if (!canTransitionDocument(from, to, caps)) {
    throw new ValidationFailedError({
      fieldErrors: { status: [DOCUMENT_ERRORS.invalidTransition] },
    });
  }
}

// ───────────────────────────── Type rules ─────────────────────────────

export interface TypeRuleSubject {
  readonly status?: DocumentStatus | undefined;
  readonly signedAt?: DateOnly | null | undefined;
  readonly expiresAt?: DateOnly | null | undefined;
}

export interface TypeRuleIssue {
  readonly path: 'signedAt' | 'expiresAt' | 'status';
  readonly message: string;
}

/**
 * Issues a document breaks for its type: a signature date or the `FIRMADO` status on a type without
 * signature, an expiry date on a type without expiration.
 */
export function documentTypeRuleIssues(
  caps: DocumentTypeCapabilities,
  value: TypeRuleSubject,
): TypeRuleIssue[] {
  const issues: TypeRuleIssue[] = [];
  if (!caps.requiresSignature) {
    if (value.signedAt) {
      issues.push({ path: 'signedAt', message: DOCUMENT_VALIDATION_MESSAGES.signedAtNotAllowed });
    }
    if (value.status === 'FIRMADO') {
      issues.push({ path: 'status', message: DOCUMENT_VALIDATION_MESSAGES.signedStatusNotAllowed });
    }
  }
  if (!caps.hasExpiration && value.expiresAt) {
    issues.push({ path: 'expiresAt', message: DOCUMENT_VALIDATION_MESSAGES.expiresAtNotAllowed });
  }
  return issues;
}

/** Throws `VALIDATION` with one field error per broken type rule (lesson B2: never only in a DTO). */
export function assertDocumentTypeRules(
  caps: DocumentTypeCapabilities,
  value: TypeRuleSubject,
): void {
  const issues = documentTypeRuleIssues(caps, value);
  if (issues.length === 0) return;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) (fieldErrors[issue.path] ??= []).push(issue.message);
  throw new ValidationFailedError({ fieldErrors });
}

/** The expiry cannot precede the effective date. Date-only strings compare lexically. */
export function assertDocumentDates(value: {
  readonly effectiveDate?: DateOnly | null | undefined;
  readonly expiresAt?: DateOnly | null | undefined;
}): void {
  if (value.effectiveDate && value.expiresAt && value.expiresAt < value.effectiveDate) {
    throw new ValidationFailedError({
      fieldErrors: { expiresAt: [DOCUMENT_FIELD_ERRORS.invalidDate] },
    });
  }
}

// ───────────────────────────── Expiry and version lock (DT-138) ─────────────────────────────

/**
 * Whether the expiry step marks a document `VENCIDO` on `today` (Caracas): every live document except `ANULADO`
 * and `VENCIDO` whose `expiresAt` is before today. Archived documents are skipped until restored.
 */
export function isExpiredDocument(
  doc: {
    readonly status: DocumentStatus;
    readonly expiresAt: DateOnly | null;
    readonly archived: boolean;
  },
  today: DateOnly,
): boolean {
  if (doc.archived || doc.expiresAt === null) return false;
  if (doc.status === 'ANULADO' || doc.status === 'VENCIDO') return false;
  return doc.expiresAt < today;
}

/** A `FIRMADO` document accepts no version nor draft; neither does a `VENCIDO` one with `signedAt` (PRD:902). */
export function isVersionLocked(doc: {
  readonly status: DocumentStatus;
  readonly signedAt: DateOnly | null;
}): boolean {
  return doc.status === 'FIRMADO' || (doc.status === 'VENCIDO' && doc.signedAt !== null);
}

export function assertVersionAllowed(doc: {
  readonly status: DocumentStatus;
  readonly signedAt: DateOnly | null;
}): void {
  if (isVersionLocked(doc)) throw new IntegrityLockedError();
}

// ───────────────────────────── Format rules ─────────────────────────────

/**
 * The editor only writes markdown documents: the format of the current version, else the type's default. A file or
 * link document is `CONFLICT`.
 */
export function assertMarkdownDocument(
  currentFormat: DocumentFormat | null,
  typeDefaultFormat: DocumentFormat,
): void {
  if ((currentFormat ?? typeDefaultFormat) !== 'MARKDOWN') throw new ConflictError();
}

/** `http:` / `https:` URL with a host. Rejects `javascript:`, `data:`, `file:` and friends (C4). */
export function isHttpUrl(value: string): boolean {
  if (value.length > HTTP_URL_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** The trimmed URL of an `ENLACE` version, or `VALIDATION` on `url` when it is not `http(s)`. */
export function assertHttpUrlForLink(url: string): string {
  const trimmed = url.trim();
  if (!isHttpUrl(trimmed)) {
    throw new ValidationFailedError({
      fieldErrors: { url: [DOCUMENT_FIELD_ERRORS.invalidFormat] },
    });
  }
  return trimmed;
}
