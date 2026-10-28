import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';

/**
 * Tags (PRD §7.5): a global catalog of name + colour that can be assigned to clients, contacts, projects,
 * invoices, payments, expenses, documents and notes. Ported from `fe/src/lib/validators/tags.ts` and
 * `fe/src/mocks/services/tags.ts`. Pure: no Zod, no framework, no clock.
 */

/** Entities a tag can be assigned to (PRD §7.5); the same values as the `EntityType` enum. */
export const TAGGABLE_ENTITY_TYPE_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'DOCUMENT',
  'NOTE',
] as const;
export type TaggableEntityType = (typeof TAGGABLE_ENTITY_TYPE_VALUES)[number];

export function isTaggableEntityType(value: string): value is TaggableEntityType {
  return (TAGGABLE_ENTITY_TYPE_VALUES as readonly string[]).includes(value);
}

/** Longest tag name, counted on the trimmed value (FE `tagNameSchema = requiredText(40)`). */
export const TAG_NAME_MAX_LENGTH = 40;
/** `#RRGGBB` (FE `hexColorSchema`). */
export const TAG_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** i18n keys the mock and the FE validators use, reused verbatim (FE-INT needs no new message). */
export const TAG_NAME_TAKEN_KEY = 'tags.errors.nameTaken';
export const INVALID_OPTION_KEY = 'validation.invalidOption';
const KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
} as const;

/** Fields compared for the `UPDATE` activity entry, in the order they are recorded. */
export const TAG_ACTIVITY_FIELDS = ['name', 'color'] as const;

export interface Tag {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly createdAt: Date;
}

/** A tag with the number of non-archived records carrying it (`tagUsage` of the mock). */
export interface TagWithUsage extends Tag {
  readonly usageCount: number;
}

/** Compact tag shown as a chip on tables, cards and the graph. */
export interface TagChip {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export function toTagChip(tag: Pick<Tag, 'id' | 'name' | 'color'>): TagChip {
  return { id: tag.id, name: tag.name, color: tag.color };
}

/** The record a tag is assigned to. */
export interface TagTarget {
  readonly entityType: TaggableEntityType;
  readonly entityId: string;
}

/** Stable map key of a target. */
export function targetKey(target: TagTarget): string {
  return `${target.entityType}:${target.entityId}`;
}

/** Case- and space-insensitive name comparison (the mock's `sameName`). */
export function sameTagName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** Trimmed, non-empty name of at most 40 characters; otherwise `VALIDATION` on `name`. */
export function normalizeTagName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw invalid({ name: [KEYS.required] });
  if (name.length > TAG_NAME_MAX_LENGTH) throw invalid({ name: [KEYS.tooLong] });
  return name;
}

/** `#RRGGBB`; otherwise `VALIDATION` on `color`. */
export function assertTagColor(color: string): string {
  if (!TAG_COLOR_PATTERN.test(color)) throw invalid({ color: [KEYS.invalidFormat] });
  return color;
}

/** Order of a tag's chips on a record: creation order, then id (stable). */
export function compareTagsForChips(a: Tag, b: Tag): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** `{ field: [before, after] }` of a rename/recolour, or `null` when nothing changed. */
export function tagChanges(
  before: Pick<Tag, 'name' | 'color'>,
  after: Pick<Tag, 'name' | 'color'>,
): ActivityChanges | null {
  return diffFields(before, after, { fields: TAG_ACTIVITY_FIELDS });
}

function invalid(fieldErrors: FieldErrors): ValidationFailedError {
  return new ValidationFailedError({ fieldErrors });
}
