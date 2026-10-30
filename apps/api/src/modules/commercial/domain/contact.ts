import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import {
  FIELD_KEYS,
  isE164Phone,
  optionalEmail,
  optionalText,
  requiredText,
  tagIdList,
  type TagChipView,
} from './client-fields';

/**
 * Contacts (PRD §8.2 "Contacto", HU-04). Ported from `fe/src/lib/validators/contacts.ts` and
 * `fe/src/mocks/services/contacts.ts`. A contact needs a name and at least one contact method (CA1); a
 * client has at most one primary contact (CA2). Contact rows carry no `deletedById` and no cascade marker:
 * the client cascade is told by `deletedAt` (the contact's equals its client's).
 */

export const CONTACT_LIMITS = { fullName: 120, position: 80 } as const;

/** `CONFLICT` message of a restore through the trash whose client is still archived. */
export const TRASH_CLIENT_ARCHIVED_KEY = 'trash.errors.clientArchived';

/** Fields compared for the `UPDATE` activity entry, in the order they are recorded. */
export const CONTACT_DIFF_FIELDS = [
  'fullName',
  'position',
  'email',
  'phone',
  'isPrimary',
  'tagIds',
] as const;

/** Sort keys of the contacts list. */
export const CONTACT_SORT_FIELDS = [
  'fullName',
  'position',
  'email',
  'isPrimary',
  'createdAt',
] as const;

/** Stored values of a contact, already normalized. */
export type ContactValues = {
  readonly fullName: string;
  readonly position: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly isPrimary: boolean;
};

export type ContactRecord = ContactValues & {
  readonly id: string;
  readonly clientId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
};

/** What a caller sends to create or replace a contact. */
export type ContactInput = {
  readonly fullName: string;
  readonly position?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly isPrimary?: boolean;
  readonly tagIds?: readonly string[];
};

export type NormalizedContact = {
  readonly values: ContactValues;
  readonly tagIds: string[];
};

/**
 * Validates and normalizes a contact form. Name plus e-mail or phone (CA1): when both are missing the
 * `required` key is reported on both fields, so each shows the message (as the FE refinement does).
 */
export function normalizeContact(input: ContactInput): NormalizedContact {
  const errors: FieldErrors = {};
  const fullName = requiredText(errors, 'fullName', input.fullName, CONTACT_LIMITS.fullName);
  const position = optionalText(errors, 'position', input.position, CONTACT_LIMITS.position);
  const email = optionalEmail(errors, 'email', input.email);
  const phoneText = (input.phone ?? '').trim();
  let phone: string | null = null;
  if (phoneText.length > 0) {
    phone = phoneText;
    if (!isE164Phone(phoneText)) errors.phone = [FIELD_KEYS.invalidFormat];
  }
  if (email === null && phone === null && !errors.email && !errors.phone) {
    errors.email = [FIELD_KEYS.required];
    errors.phone = [FIELD_KEYS.required];
  }
  const tagIds = tagIdList(errors, 'tagIds', input.tagIds);

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return {
    values: { fullName, position, email, phone, isPrimary: input.isPrimary ?? false },
    tagIds,
  };
}

/** The `UPDATE` change set (tag names as one readable string), or `null` when nothing changed. */
export function contactChanges(
  before: ContactValues,
  after: ContactValues,
  tagNames: { readonly before: string; readonly after: string },
): ActivityChanges | null {
  return diffFields(
    { ...before, tagIds: tagNames.before },
    { ...after, tagIds: tagNames.after },
    { fields: CONTACT_DIFF_FIELDS },
  );
}

const collator = new Intl.Collator('es', { sensitivity: 'base' });

/** Primary first, then by name: the order of the "highlighted contacts" in the client detail. */
export function sortContacts<T extends Pick<ContactRecord, 'isPrimary' | 'fullName'>>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || collator.compare(a.fullName, b.fullName),
  );
}

export function toContactRef(record: Pick<ContactRecord, 'id' | 'fullName'>): EntityRef {
  return { type: 'CONTACT', id: record.id, label: record.fullName };
}

/** The `SearchEntry` projection of a contact (HU-04 CA3): name, position and the contact methods. */
export function contactSearchEntry(record: ContactRecord) {
  const body = [record.email, record.phone].filter((part) => part !== null).join(' ');
  return {
    entityType: 'CONTACT' as const,
    entityId: record.id,
    code: null,
    title: record.fullName,
    subtitle: record.position,
    body: body.length > 0 ? body : null,
    status: null,
    archived: record.deletedAt !== null,
  };
}

/** A contact with its tag chips: the read model of the list and the detail. */
export type ContactView = {
  readonly contact: ContactRecord;
  readonly tags: TagChipView[];
};
