import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { NoteLinkTarget } from '../../domain/note-link';

export const NOTE_TARGET = Symbol('NOTE_TARGET');

/** A record a note can hang from, as the registry and the note views see it. */
export interface ResolvedNoteTarget {
  readonly ref: EntityRef;
  /** `true` when the record is archived: still shown on existing links, refused for new ones. */
  readonly archived: boolean;
}

/**
 * Resolves the targets the commercial context owns (clients, contacts, projects). Archived rows are
 * returned with `archived: true` so existing links keep their label; an unknown id is simply absent.
 * Keys are `linkKey(target)`.
 */
export interface NoteTargetPort {
  resolve(targets: readonly NoteLinkTarget[]): Promise<Map<string, ResolvedNoteTarget>>;
}
