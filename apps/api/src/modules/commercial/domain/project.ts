import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import type { DateOnly } from '../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { ProjectStatus, TechCategory } from '../../../shared/domain/enums';
import {
  imageFileIds,
  richTextToPlainText,
  sanitizeRichTextDoc,
  type RichTextDoc,
} from '../../../shared/domain/rich-text';
import type { ProjectStatusHint } from './project-status';
import type { ProjectLinkRecord } from './project-link';

/**
 * Projects (PRD §8.3, HU-05…HU-08). Ported from `fe/src/mocks/services/projects.ts` and
 * `fe/src/lib/validators/projects.ts`. Pure: no Zod, no framework, no clock (instants are passed in).
 */

export const PROJECT_LIMITS = { name: 120, summary: 280, clientRole: 80, clients: 30 } as const;

/** i18n keys the mock and the FE validators use, reused verbatim (FE-INT needs no new message). */
export const PROJECT_KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
  invalidOption: 'validation.invalidOption',
  invalidDate: 'validation.date.invalid',
  clientNotFound: 'projects.errors.clientNotFound',
  technologyUnknown: 'projects.errors.technologyUnknown',
  technologyInactive: 'projects.errors.technologyInactive',
  invalidTransition: 'projects.errors.invalidTransition',
  archiveNeedsConfirm: 'projects.errors.archiveNeedsConfirm',
} as const;

/** One client of a project with an optional free-text role ("Contratante", "Usuario final"). */
export interface ProjectClientLink {
  readonly clientId: string;
  readonly role: string | null;
  /** When the client was linked: the earliest link is the project's activity scope (Q-BE2-2). */
  readonly linkedAt: Date;
}

export interface ProjectRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly summary: string;
  readonly description: RichTextDoc | null;
  /** Plain-text projection of `description`, for search. */
  readonly descriptionText: string | null;
  readonly status: ProjectStatus;
  readonly startDate: DateOnly | null;
  readonly targetEndDate: DateOnly | null;
  readonly endDate: DateOnly | null;
  /** In link order (earliest first). */
  readonly clients: readonly ProjectClientLink[];
  readonly technologyIds: readonly string[];
  readonly links: readonly ProjectLinkRecord[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** `deletedAt`: set while the project is archived. */
  readonly archivedAt: Date | null;
}

/** A client of the project as a caller sends it. */
export interface ProjectClientInput {
  readonly clientId: string;
  readonly role?: string | null | undefined;
}

/** The editable scalar fields of a project, as a caller sends them. */
export interface ProjectFieldsInput {
  readonly name: string;
  readonly summary: string;
  readonly description?: RichTextDoc | null | undefined;
  readonly startDate?: DateOnly | null | undefined;
  readonly targetEndDate?: DateOnly | null | undefined;
  readonly endDate?: DateOnly | null | undefined;
}

/** The editable scalar fields, normalized. */
export interface ProjectFields {
  readonly name: string;
  readonly summary: string;
  readonly description: RichTextDoc | null;
  readonly descriptionText: string | null;
  readonly startDate: DateOnly | null;
  readonly targetEndDate: DateOnly | null;
  readonly endDate: DateOnly | null;
}

function invalid(fieldErrors: FieldErrors): ValidationFailedError {
  return new ValidationFailedError({ fieldErrors });
}

/**
 * Trims and checks the scalar fields: name 1..120, summary 1..280, a sanitized description (allowlist, size)
 * with no image nodes in it
 * (a project has no attachments, contract choice 6) and no end date before the start. Every failure is
 * reported at once.
 */
export function normalizeProjectFields(input: ProjectFieldsInput): ProjectFields {
  const fieldErrors: FieldErrors = {};
  const fail = (field: string, key: string): void => {
    (fieldErrors[field] ??= []).push(key);
  };

  const name = input.name.trim();
  if (name.length === 0) fail('name', PROJECT_KEYS.required);
  else if (name.length > PROJECT_LIMITS.name) fail('name', PROJECT_KEYS.tooLong);

  const summary = input.summary.trim();
  if (summary.length === 0) fail('summary', PROJECT_KEYS.required);
  else if (summary.length > PROJECT_LIMITS.summary) fail('summary', PROJECT_KEYS.tooLong);

  // Sanitized here, not in the DTO, so no caller can skip it (as `prepareNoteContent` does for notes).
  let description: RichTextDoc | null = null;
  if (input.description !== null && input.description !== undefined) {
    const result = sanitizeRichTextDoc(input.description);
    if (!result.ok) {
      fail(
        'description',
        result.reason === 'tooLong' ? PROJECT_KEYS.tooLong : PROJECT_KEYS.invalidFormat,
      );
    } else if (imageFileIds(result.doc).length > 0) {
      fail('description', PROJECT_KEYS.invalidFormat);
    } else {
      description = result.doc;
    }
  }
  const text = description === null ? '' : richTextToPlainText(description).trim();

  const startDate = input.startDate ?? null;
  const targetEndDate = input.targetEndDate ?? null;
  const endDate = input.endDate ?? null;
  for (const [field, end] of [
    ['targetEndDate', targetEndDate],
    ['endDate', endDate],
  ] as const) {
    if (startDate !== null && end !== null && end < startDate) {
      fail(field, PROJECT_KEYS.invalidDate);
    }
  }

  if (Object.keys(fieldErrors).length > 0) throw invalid(fieldErrors);
  return {
    name,
    summary,
    description,
    descriptionText: text.length > 0 ? text : null,
    startDate,
    targetEndDate,
    endDate,
  };
}

/** `EN_CURSO` needs a start date and `ENTREGADO` an actual end date (HU-08 CA1, CA2). */
export function assertStatusDates(
  status: ProjectStatus,
  dates: { readonly startDate: DateOnly | null; readonly endDate: DateOnly | null },
): void {
  if (status === 'EN_CURSO' && dates.startDate === null) {
    throw invalid({ startDate: [PROJECT_KEYS.required] });
  }
  if (status === 'ENTREGADO' && dates.endDate === null) {
    throw invalid({ endDate: [PROJECT_KEYS.required] });
  }
}

/**
 * The clients of a project: at least one, none repeated, role trimmed (empty = none). `linkedAt` keeps
 * the instant of a client that was already linked and stamps new ones `now + position` ms, so the
 * earliest link is deterministic (the first client of a new project).
 */
export function normalizeProjectClients(
  inputs: readonly ProjectClientInput[],
  now: Date,
  existing: readonly ProjectClientLink[] = [],
): ProjectClientLink[] {
  if (inputs.length === 0) throw invalid({ clients: [PROJECT_KEYS.required] });
  const ids = inputs.map((input) => input.clientId);
  if (new Set(ids).size !== ids.length) throw invalid({ clients: [PROJECT_KEYS.invalidOption] });

  const fieldErrors: FieldErrors = {};
  const links = inputs.map((input, index) => {
    const role = input.role?.trim() ?? '';
    if (role.length > PROJECT_LIMITS.clientRole) {
      fieldErrors[`clients.${index}.role`] = [PROJECT_KEYS.tooLong];
    }
    const kept = existing.find((link) => link.clientId === input.clientId);
    return {
      clientId: input.clientId,
      role: role.length > 0 ? role : null,
      linkedAt: kept ? kept.linkedAt : new Date(now.getTime() + index),
    };
  });
  if (Object.keys(fieldErrors).length > 0) throw invalid(fieldErrors);
  return links;
}

/** The client the project's activity is scoped to: the earliest link (Q-BE2-2). */
export function earliestClientId(clients: readonly ProjectClientLink[]): string | null {
  const first = [...clients].sort(
    (a, b) => a.linkedAt.getTime() - b.linkedAt.getTime() || (a.clientId < b.clientId ? -1 : 1),
  )[0];
  return first?.clientId ?? null;
}

/** Client links that appeared, disappeared or changed role between `before` and `after`. */
export interface ClientLinkChange {
  readonly kind: 'LINK' | 'UNLINK' | 'ROLE';
  readonly clientId: string;
  readonly role: string | null;
  readonly previousRole: string | null;
}

export function diffClientLinks(
  before: readonly ProjectClientLink[],
  after: readonly ProjectClientLink[],
): ClientLinkChange[] {
  const changes: ClientLinkChange[] = [];
  for (const link of after) {
    const previous = before.find((item) => item.clientId === link.clientId);
    if (!previous) {
      changes.push({ kind: 'LINK', clientId: link.clientId, role: link.role, previousRole: null });
    } else if (previous.role !== link.role) {
      changes.push({
        kind: 'ROLE',
        clientId: link.clientId,
        role: link.role,
        previousRole: previous.role,
      });
    }
  }
  for (const link of before) {
    if (after.some((item) => item.clientId === link.clientId)) continue;
    changes.push({ kind: 'UNLINK', clientId: link.clientId, role: link.role, previousRole: null });
  }
  return changes;
}

/** Fields of a project the `UPDATE` diff compares, in the order they are recorded. */
export const PROJECT_UPDATE_DIFF_FIELDS = [
  'name',
  'summary',
  'description',
  'startDate',
  'targetEndDate',
  'endDate',
  'technologyIds',
  'tagIds',
] as const;

/** Catalog names, sorted and joined: the readable snapshot the diff logs, never ids (C1). */
export function sortedNames(names: readonly string[]): string {
  return [...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).join(', ');
}

/** The editable fields as the `UPDATE` diff sees them (stack and tags as sorted names, description as JSON). */
export function projectDiffView(
  record: Pick<
    ProjectRecord,
    'name' | 'summary' | 'description' | 'startDate' | 'targetEndDate' | 'endDate'
  >,
  technologyNames: readonly string[],
  tagNames: readonly string[],
): Record<string, unknown> {
  return {
    name: record.name,
    summary: record.summary,
    description: record.description ? JSON.stringify(record.description) : null,
    startDate: record.startDate,
    targetEndDate: record.targetEndDate,
    endDate: record.endDate,
    technologyIds: sortedNames(technologyNames),
    tagIds: sortedNames(tagNames),
  };
}

export function projectChanges(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  fields: readonly string[] = PROJECT_UPDATE_DIFF_FIELDS,
): ActivityChanges | null {
  return diffFields(before, after, { fields, longText: ['description'] });
}

/** What the search index stores for a project (code, name, client names, summary + description text). */
export interface ProjectSearchDocument {
  readonly code: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly body: string | null;
  readonly status: ProjectStatus;
}

export function projectSearchDocument(
  record: Pick<ProjectRecord, 'code' | 'name' | 'summary' | 'descriptionText' | 'status'>,
  clientNames: readonly string[],
): ProjectSearchDocument {
  const body = [record.summary, record.descriptionText].filter((part): part is string => !!part);
  return {
    code: record.code,
    title: record.name,
    subtitle: clientNames.length > 0 ? clientNames.join(', ') : null,
    body: body.length > 0 ? body.join('\n') : null,
    status: record.status,
  };
}

// ───────────────────────────── Output models ─────────────────────────────

/** Chip of a technology on a project's stack. */
export interface TechnologyChipView {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly category: TechCategory;
  readonly iconSlug: string | null;
  readonly color: string | null;
}

export interface TagChipView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface ProjectClientView {
  readonly client: EntityRef;
  readonly role: string | null;
}

/** Money headline from `ProjectMetrics`; `null` without `canSeeFinancials` (C13). */
export interface ProjectFinancialHeadline {
  readonly contractedValueUsd: string | null;
  readonly invoicedUsd: string | null;
  readonly collectedUsd: string | null;
  readonly toInvoiceUsd: string | null;
}

export interface ProjectListRowView extends ProjectFinancialHeadline {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly clients: readonly ProjectClientView[];
  readonly status: ProjectStatus;
  readonly startDate: DateOnly | null;
  readonly targetEndDate: DateOnly | null;
  readonly stack: readonly TechnologyChipView[];
  readonly tags: readonly TagChipView[];
  readonly archivedAt: Date | null;
}

export interface ProjectDetailView extends ProjectListRowView {
  readonly summary: string;
  readonly description: RichTextDoc | null;
  readonly endDate: DateOnly | null;
  readonly links: readonly ProjectLinkRecord[];
  readonly hasBillingPlan: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectStatusChangeView {
  readonly project: ProjectDetailView;
  readonly hints: readonly ProjectStatusHint[];
}

export interface ArchivedProjectView {
  readonly id: string;
  readonly archivedAt: Date;
}
