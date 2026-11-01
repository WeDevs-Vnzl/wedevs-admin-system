import { ValidationFailedError } from '../../../shared/domain/domain-error';

/** Entities a note can hang from (PRD §8.10), the values of the FE `NOTE_LINK_ENTITY_TYPE_VALUES`. */
export const NOTE_LINK_ENTITY_TYPE_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'DOCUMENT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
] as const;
export type NoteLinkEntityType = (typeof NOTE_LINK_ENTITY_TYPE_VALUES)[number];

/** Target types the commercial context owns and resolves itself; the rest come from a registry. */
export const OWN_NOTE_LINK_TYPE_VALUES = ['CLIENT', 'CONTACT', 'PROJECT'] as const;
export type OwnNoteLinkType = (typeof OWN_NOTE_LINK_TYPE_VALUES)[number];

/** The record a note is linked to. */
export interface NoteLinkTarget {
  readonly entityType: NoteLinkEntityType;
  readonly entityId: string;
}

/** i18n keys of the mock, reused verbatim. */
export const NOTE_ALREADY_LINKED_KEY = 'notes.errors.alreadyLinked';
export const NOTE_LAST_LINK_KEY = 'notes.errors.lastLink';
export const INVALID_OPTION_KEY = 'validation.invalidOption';

export function isNoteLinkEntityType(value: string): value is NoteLinkEntityType {
  return (NOTE_LINK_ENTITY_TYPE_VALUES as readonly string[]).includes(value);
}

export function isOwnNoteLinkType(value: string): value is OwnNoteLinkType {
  return (OWN_NOTE_LINK_TYPE_VALUES as readonly string[]).includes(value);
}

/** Stable map key of a target. */
export function linkKey(target: NoteLinkTarget): string {
  return `${target.entityType}:${target.entityId}`;
}

export function sameLink(a: NoteLinkTarget, b: NoteLinkTarget): boolean {
  return a.entityType === b.entityType && a.entityId === b.entityId;
}

/** A link list holds no target twice; otherwise `VALIDATION` on `field` (`validation.invalidOption`). */
export function assertDistinctLinks(links: readonly NoteLinkTarget[], field = 'links'): void {
  const seen = new Set<string>();
  for (const link of links) {
    const key = linkKey(link);
    if (seen.has(key)) {
      throw new ValidationFailedError({ fieldErrors: { [field]: [INVALID_OPTION_KEY] } });
    }
    seen.add(key);
  }
}

/**
 * The client scope of a note's activity (Q-BE2-2): `clientId` is the first client target (the earliest
 * link) and every client target gets its `lastActivityAt` bumped.
 */
export function clientScopeOf(links: readonly NoteLinkTarget[]): {
  clientId: string | null;
  touchClientIds: string[];
} {
  const clientIds = [
    ...new Set(links.filter((l) => l.entityType === 'CLIENT').map((l) => l.entityId)),
  ];
  return { clientId: clientIds[0] ?? null, touchClientIds: clientIds };
}
